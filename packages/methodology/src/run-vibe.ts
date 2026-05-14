/**
 * `runVibe` — subprocess-spawn bridge to `swt cook` (Phase 5 plan 05-04 T1).
 *
 * **R8 (architect): subprocess-spawn (option c).** The prior alpha's
 * Execute-mode driver (vibe/handlers/execute.ts) was deleted per TDD3 §23.6
 * and replaced by the `swt cook` orchestrator (TypeScript handler at
 * `packages/cli/src/commands/cook.ts`, CLI verb registered in
 * `packages/cli/src/main.ts`). Wave 3 of Phase 5 needed a programmatic
 * entry into cook that does NOT couple methodology back to cli (option a —
 * inverts the dep graph) and does NOT require a non-trivial cook.ts
 * refactor (option b). Subprocess-spawn was chosen for minimal-refactor +
 * preserves cook.ts as-is. Per research §6.6 + §7 R8: spawn overhead is
 * ~500ms × ~6-10 phases = 3-5s total, acceptable for <60s CI budget.
 *
 * **Contract:** spawn `process.execPath` with the resolved swt cli bundle
 * (default: `dist/cli.mjs` — the production tsup bundle), pass `cook` as
 * the verb, inherit `SWT_*` env vars, await exit. On exit, harvest:
 *
 *   - `criteria_satisfied` — sum of `passed: N` across every
 *     `phases/<NN>-*\/<NN>-VERIFICATION.md` under the planning root.
 *   - `meter_snapshot` — lifted from `.swt-planning/.metrics/{session,phase}-*.json`
 *     (written by Phase 4 04-01 token-meter) into a `MeterSnapshot` via
 *     `liftMeterSnapshot()` (Phase 5 plan 05-04 T2, in `@swt-labs/orchestration`).
 *
 * **Non-throw semantics:** `runVibe()` returns the child's exit code
 * rather than throwing on non-zero. Callers (`runMilestone`, `swt bench`)
 * map non-zero codes to their own error surface. This keeps `runVibe`
 * pure for tests asserting specific exit codes.
 *
 * **Cross-process cassette inheritance (Phase 6 plan 06-04 T3).** When
 * `installReplay(path)` is called in the parent, the helper writes
 * `SWT_CASSETTE_PATH=path` onto `process.env`. The child subprocess
 * spawned below inherits the parent's env (`env: { ...process.env, ... }`),
 * so the cook child receives `SWT_CASSETTE_PATH` and can call
 * `installReplayFromEnv()` at startup to swap its own undici dispatcher
 * to the cassette replayer before any HTTP traffic. The CLI entry at
 * `packages/cli/src/main.ts` performs this boot hook via a dynamic
 * import gated on the env var (so the production bundle does not pull
 * in `@swt-labs/test-utils` when no cassette is configured). Closes
 * DEVN-04 from Phase 5 PARITY-REPORT.md:130 (R3).
 */

import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { liftMeterSnapshot, countSatisfiedCriteria } from '@swt-labs/orchestration';
import type { MeterSnapshot } from '@swt-labs/shared';

export interface RunVibeOptions {
  /** Project working directory (where `.swt-planning/` will be produced). */
  readonly cwd: string;
  /**
   * Legacy fields from the deferred-stub contract. Accepted but ignored
   * by the subprocess-spawn implementation; preserved so callers
   * compiled against the prior shape (`@swt-labs/test-utils`
   * `runMilestone`) still typecheck until T4 rewires them.
   */
  readonly meter?: unknown;
  readonly meterContext?: unknown;
  readonly harvestStrategy?: unknown;
  readonly phase?: string;
  readonly slug?: string;
  /** Override the planning root. Defaults to `${cwd}/.swt-planning`. */
  readonly planningRoot?: string;
  /** Override the session id passed to cook. Defaults to `crypto.randomUUID()`. */
  readonly sessionId?: string;
  /** Milestone label used when lifting the meter snapshot. Defaults to the basename of `cwd`. */
  readonly milestone?: string;
  /**
   * Override the path to the swt CLI bundle (`.mjs` or `.js`). Defaults to:
   *   1. `process.env.SWT_CLI_BIN` (used by tests)
   *   2. `<repo>/dist/cli.mjs` (production tsup bundle)
   *   3. `require.resolve('@swt-labs/cli')` (workspace fallback)
   */
  readonly swtBin?: string;
  /** Force non-interactive mode (sets `SWT_FORCE_NON_INTERACTIVE=1`). Defaults to `true`. */
  readonly nonInteractive?: boolean;
  /** Subprocess timeout in milliseconds. Defaults to 120_000 (2 min). */
  readonly spawnTimeoutMs?: number;
  /**
   * Default provider label applied to lifted meter records when the
   * `.metrics/` JSON files lack a provider field. Defaults to `'anthropic'`.
   */
  readonly defaultProvider?: string;
  /**
   * Default model label applied to lifted meter records when the
   * `.metrics/` JSON files lack a model field. Defaults to `'unknown'`.
   */
  readonly defaultModel?: string;
}

export interface RunVibeResult {
  /** Session id passed to (or generated for) the spawned cook subprocess. */
  readonly sessionId: string;
  /** Absolute planning root used by the spawned cook subprocess. */
  readonly planningRoot: string;
  /** Child process exit code (0 on success). Non-zero is returned, not thrown. */
  readonly exitCode: number;
  /** Sum of `passed:` counts across every phase's VERIFICATION.md under `planningRoot`. */
  readonly criteriaSatisfied: number;
  /** Meter snapshot lifted from `.swt-planning/.metrics/*.json` after the run. */
  readonly meterSnapshot: MeterSnapshot;
  /** Wall-clock duration of the subprocess in milliseconds. */
  readonly durationMs: number;
  /**
   * Spawn overhead in milliseconds (time between `spawn()` and child's
   * first metric write). Instrumented per R3 to validate the 3-5s CI
   * budget. When the run produces no metrics, defaults to 0.
   */
  readonly spawnOverheadMs: number;
  /**
   * Legacy field — pre-Phase 5 callers consumed `artefactsPath`. Kept as
   * an alias for `planningRoot` to soften the contract migration.
   */
  readonly artefactsPath: string;
}

/**
 * Spawn `swt cook` as a child process and harvest the produced
 * `.swt-planning/` tree into a `RunVibeResult`.
 */
export function runVibe(opts: RunVibeOptions): Promise<RunVibeResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const planningRoot = opts.planningRoot ?? join(opts.cwd, '.swt-planning');
  const milestone = opts.milestone ?? basename(opts.cwd);
  const swtBin = resolveSwtBin(opts.swtBin);
  const nonInteractive = opts.nonInteractive !== false;
  const spawnTimeoutMs = opts.spawnTimeoutMs ?? 120_000;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SWT_PLANNING_ROOT: planningRoot,
    SWT_SESSION_ID: sessionId,
  };
  if (nonInteractive) {
    env['SWT_FORCE_NON_INTERACTIVE'] = '1';
  }

  return new Promise<RunVibeResult>((resolve, reject) => {
    const start = Date.now();
    let firstMetricsAt = 0;
    const metricsDir = join(planningRoot, '.metrics');

    const child = spawn(process.execPath, [swtBin, 'cook'], {
      cwd: opts.cwd,
      env,
      stdio: 'pipe',
    });

    // Poll once for the first metrics file to land — approximates
    // spawn-overhead by capturing the gap between `spawn()` and the
    // first SessionMetrics write. Cheap (one stat per 50ms, cancelled
    // on exit). Provides a sane R3 instrument until plan 06 adds an
    // `.events/cook-*.jsonl` timestamp diff.
    const poller = setInterval(() => {
      if (firstMetricsAt > 0) return;
      try {
        const entries = readdirSync(metricsDir);
        if (entries.some((e) => e.startsWith('session-') || e.startsWith('phase-'))) {
          firstMetricsAt = Date.now();
        }
      } catch {
        // metricsDir not present yet — keep polling
      }
    }, 50);

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, spawnTimeoutMs);

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuf += chunk.toString();
    });
    child.stdout?.on('data', () => {
      // Drained to avoid backpressure; cook's stdout is JSONL/text the
      // dashboard tails — we capture nothing here.
    });

    child.on('error', (err: Error) => {
      clearInterval(poller);
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code: number | null) => {
      clearInterval(poller);
      clearTimeout(timeout);
      const exitCode = code ?? 1;
      const durationMs = Date.now() - start;
      const spawnOverheadMs = firstMetricsAt > 0 ? firstMetricsAt - start : 0;

      try {
        const criteriaSatisfied = countSatisfiedCriteria(planningRoot);
        const meterSnapshot = liftMeterSnapshot({
          planningRoot,
          milestone,
          ...(opts.defaultProvider !== undefined ? { defaultProvider: opts.defaultProvider } : {}),
          ...(opts.defaultModel !== undefined ? { defaultModel: opts.defaultModel } : {}),
        });

        resolve({
          sessionId,
          planningRoot,
          exitCode,
          criteriaSatisfied,
          meterSnapshot,
          durationMs,
          spawnOverheadMs,
          artefactsPath: planningRoot,
        });
      } catch (err) {
        // Harvest failure is exposed as a reject — caller distinguishes
        // a clean non-zero exit (resolve with exitCode) from a harvest
        // crash (reject). stderrBuf is forwarded for diagnostics.
        const wrapped = new Error(
          `runVibe: harvest failed after child exit (code ${exitCode}): ${err instanceof Error ? err.message : String(err)}` +
            (stderrBuf.length > 0 ? `\nchild stderr:\n${stderrBuf}` : ''),
        );
        reject(wrapped);
      }
    });
  });
}

/**
 * Resolve the swt CLI bundle path. Resolution order:
 *   1. Caller-supplied `opts.swtBin`.
 *   2. `process.env.SWT_CLI_BIN` (test override).
 *   3. `<repo>/dist/cli.mjs` (production tsup bundle, walking up).
 *   4. `require.resolve('@swt-labs/cli')` (workspace dev path).
 */
function resolveSwtBin(override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  const envOverride = process.env['SWT_CLI_BIN'];
  if (envOverride !== undefined && envOverride.length > 0) return envOverride;
  const here = currentDir();
  // Walk up from this file looking for a `dist/cli.mjs`. Handles both
  // the local-dev path (`packages/methodology/src/run-vibe.ts`) and the
  // tsup-bundled path (everything inlined into `dist/cli.mjs`).
  const candidates = [
    join(here, '..', '..', '..', '..', 'dist', 'cli.mjs'),
    join(here, '..', '..', '..', 'dist', 'cli.mjs'),
    join(here, '..', '..', 'dist', 'cli.mjs'),
    join(here, '..', 'dist', 'cli.mjs'),
    join(process.cwd(), 'dist', 'cli.mjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    const require_ = createRequire(import.meta.url);
    return require_.resolve('@swt-labs/cli');
  } catch {
    throw new Error(
      'runVibe: could not resolve swt CLI bundle. Set SWT_CLI_BIN or pass `swtBin` ' +
        'to point at a built `dist/cli.mjs`.',
    );
  }
}

function currentDir(): string {
  try {
    return fileURLToPath(new URL('.', import.meta.url));
  } catch {
    return process.cwd();
  }
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? norm : norm.slice(idx + 1);
}
