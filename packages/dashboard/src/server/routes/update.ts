import { spawn as nodeSpawn } from 'node:child_process';

import {
  CURRENT_VERSION,
  queryLatestVersion,
  type QueryOptions,
  type RegistryResult,
} from '@swt-labs/cli';
import type { UpdateApplyResponse, UpdateReport } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

const PACKAGE_NAME = 'stop-wasting-tokens';
const APPLY_TIMEOUT_MS = 60_000;
const COPYABLE_SUDO_COMMAND = `sudo npm install -g ${PACKAGE_NAME}@latest`;
const ELEVATION_PATTERN = /EACCES|EPERM|permission denied/i;

/**
 * Test-friendly seam matching the SpawnLike shape from the CLI's
 * commands/update.ts handler. POST /api/update/apply spawns once and
 * captures stdio + exit; we never need streaming-progress for this
 * route because the npm install is short-lived enough to await.
 */
export interface ApplySpawnLike {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
  stdout: string;
  stderr: string;
}
export type ApplySpawnFn = (
  cmd: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<ApplySpawnLike>;

const defaultApplySpawn: ApplySpawnFn = (cmd, args, timeoutMs) =>
  new Promise<ApplySpawnLike>((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    let child;
    try {
      child = nodeSpawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ status: null, signal: null, error: err as NodeJS.ErrnoException, stdout, stderr });
      return;
    }
    const finish = (result: ApplySpawnLike): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* swallow */
      }
      finish({
        status: null,
        signal: 'SIGTERM',
        stdout,
        stderr: stderr + `\n[dashboard] ${cmd} exceeded ${timeoutMs}ms; killed.\n`,
      });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      finish({ status: null, signal: null, error: err, stdout, stderr });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      finish({ status: code ?? 0, signal, stdout, stderr });
    });
  });

export interface RegisterUpdateRouteOptions {
  /** Test seam for fetch — defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Override `~/.swt/update-cache.json` location. */
  readonly cachePath?: string;
  /** Test seam for `Date.now()` (timestamp + cache TTL). */
  readonly now?: () => number;
  /**
   * Override the version we report as "current". Defaults to the
   * `CURRENT_VERSION` constant the CLI defines (build-time-substituted via
   * tsup `define`). Tests pin a known version so assertions are stable.
   */
  readonly currentVersion?: string;
  /** Allow disabling the on-disk cache — matches `swt update --no-cache`. */
  readonly noCache?: boolean;
  /** Test seam for the apply spawn — mock to assert on EACCES paths. */
  readonly spawnFn?: ApplySpawnFn;
  /** Override the apply timeout (ms). Defaults to 60_000. */
  readonly applyTimeoutMs?: number;
}

/**
 * Registers `GET /api/update`. Mirrors the CLI's `swt update --json` data
 * access for the dashboard panel:
 *
 *   GET /api/update →
 *     {
 *       current_version,
 *       latest_version,            // null on registry error
 *       update_available,
 *       registry: 'npm',
 *       last_checked,
 *       error                      // null on success
 *     }
 *
 * Hits the npm registry with the CLI's existing 24 h on-disk cache (so a
 * 60 s panel refresh doesn't spam npmjs). Network failures are folded into
 * the response body — never crash the daemon, never 500. v2.3 ships
 * npm-only; the marketplace registry support the CLI added in 2.0.x is
 * out of scope here.
 */
export function registerUpdateRoute(app: Hono, opts: RegisterUpdateRouteOptions = {}): void {
  app.get('/api/update', async (c) => {
    const current = opts.currentVersion ?? CURRENT_VERSION;
    const queryOpts: QueryOptions = {
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.cachePath !== undefined ? { cachePath: opts.cachePath } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
      ...(opts.noCache === true ? { noCache: true } : {}),
    };

    let result: RegistryResult;
    try {
      result = await queryLatestVersion(PACKAGE_NAME, current, queryOpts);
    } catch (err) {
      // queryLatestVersion already swallows failures into `status:
      // 'unreachable'`, but a defensive try/catch protects against
      // unexpected throws (file-system errors on the cache path, etc.).
      const message = err instanceof Error ? err.message : String(err);
      const response: UpdateReport = {
        current_version: current,
        latest_version: null,
        update_available: false,
        registry: 'npm',
        last_checked: new Date().toISOString(),
        error: message,
      };
      return c.json(response);
    }

    const response: UpdateReport =
      result.status === 'unreachable'
        ? {
            current_version: result.current,
            latest_version: null,
            update_available: false,
            registry: 'npm',
            last_checked: new Date().toISOString(),
            error: result.error ?? 'registry unreachable',
          }
        : {
            current_version: result.current,
            latest_version: result.latest,
            update_available: result.status === 'outdated',
            registry: 'npm',
            last_checked: new Date().toISOString(),
            error: null,
          };
    return c.json(response);
  });

  /**
   * POST /api/update/apply — spawn `npm install -g stop-wasting-tokens@latest`
   * server-side. The dashboard apply button wraps this; the daemon does
   * the work so the user doesn't need to drop into a terminal.
   *
   * Three outcome shapes:
   *   - exit 0 → ok:true, requires_elevation:false. Real upgrade landed.
   *   - non-zero exit AND stderr/error matches EACCES/EPERM → ok:false,
   *     requires_elevation:true, copyable_command:'sudo npm install -g …'.
   *     The panel renders the copyable command; user runs it manually.
   *   - non-zero exit (network / npm itself / etc.) → ok:false,
   *     requires_elevation:false, copyable_command:null. Stdout/stderr
   *     surfaced for debugging.
   *
   * 60 s timeout is generous for npm install; matches typical real-world
   * install times for a single package on a healthy network.
   */
  const spawnFn = opts.spawnFn ?? defaultApplySpawn;
  const applyTimeoutMs = opts.applyTimeoutMs ?? APPLY_TIMEOUT_MS;
  app.post('/api/update/apply', async (c) => {
    const startedAt = Date.now();
    const result = await spawnFn('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], applyTimeoutMs);
    const duration_ms = Date.now() - startedAt;
    const errCode = result.error?.code ?? '';
    const elevation =
      errCode === 'EACCES' ||
      errCode === 'EPERM' ||
      ELEVATION_PATTERN.test(result.stderr) ||
      ELEVATION_PATTERN.test(result.stdout);

    const ok = result.status === 0;
    const response: UpdateApplyResponse = {
      ok,
      exit_code: result.status ?? -1,
      stdout: result.stdout,
      stderr:
        result.stderr +
        (result.error !== undefined && errCode !== 'EACCES' && errCode !== 'EPERM'
          ? `\n[dashboard] spawn error: ${result.error.message}\n`
          : ''),
      duration_ms,
      requires_elevation: !ok && elevation,
      copyable_command: !ok && elevation ? COPYABLE_SUDO_COMMAND : null,
    };
    return c.json(response);
  });
}
