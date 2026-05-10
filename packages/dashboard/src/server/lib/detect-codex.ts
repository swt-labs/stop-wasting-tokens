import { spawn } from 'node:child_process';

/**
 * Hand-maintained mirror of `packages/codex-driver/src/version.ts`'s
 * `CodexVersion` + `detectCodexVersion`. Allowed-verbs.ts establishes the
 * precedent: dashboard mirrors small slices of CLI-side packages rather
 * than declaring a hard `@swt-labs/codex-driver` dep, because the
 * dashboard package can be consumed as a standalone bundle in the
 * published tarball (`dist/dashboard-server.mjs` ships separately from
 * `cli.mjs`).
 *
 * If the canonical `CodexVersion` interface ever gains fields, sync them
 * here. Drift surfaces in the typed wire contract (`DoctorReportSchema`
 * — `detail` field) rather than at the type system level, so periodic
 * grep-driven review keeps both in lockstep.
 */
export interface CodexVersion {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_RE = /\b(\d+)\.(\d+)\.(\d+)\b/;

export function parseCodexVersion(stdout: string): CodexVersion | undefined {
  const m = VERSION_RE.exec(stdout);
  if (!m) return undefined;
  return {
    version: m[0],
    major: Number.parseInt(m[1] ?? '0', 10),
    minor: Number.parseInt(m[2] ?? '0', 10),
    patch: Number.parseInt(m[3] ?? '0', 10),
  };
}

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Spawns `codex --version` and parses the version string out of stdout.
 * Returns undefined on any failure (binary missing, timeout, non-zero
 * exit, unparseable output) so callers can render a 'warn' check rather
 * than surface a 500. The 3 s default timeout prevents a hung codex
 * install from blocking the doctor route.
 */
export async function detectCodexVersion(
  bin: string = 'codex',
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CodexVersion | undefined> {
  return new Promise((resolve) => {
    let stdout = '';
    let resolved = false;
    const finish = (v: CodexVersion | undefined): void => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    let child;
    try {
      child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      finish(undefined);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* swallow — already exited or never started */
      }
      finish(undefined);
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.once('error', () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        finish(parseCodexVersion(stdout));
      } else {
        finish(undefined);
      }
    });
  });
}
