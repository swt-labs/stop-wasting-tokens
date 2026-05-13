/**
 * `runMilestone` — the regression-suite test harness per TDD2 §14.6.
 *
 * **Phase 5 plan 05-04 T4 — activation.** Before this plan, `runMilestone`
 * called the deferred-stub `runVibe()` and threw. With:
 *
 *   - Plan 05-04 T1 — subprocess-spawn bridge in `runVibe()`.
 *   - Plan 05-04 T2 — `liftMeterSnapshot()` + `countSatisfiedCriteria()`
 *     in `@swt-labs/orchestration`.
 *
 * `runMilestone` now succeeds end-to-end: copies the fixture spec to a
 * tmpdir, installs every cassette in the fixture's `cassettes/` dir,
 * invokes `runVibe()` against the tmpdir, lifts the resulting
 * `.swt-planning/.metrics/` into a `MeterSnapshot`, computes a
 * `TpacReport` via `computeTpac()`, and (by default) writes the report
 * to `.swt-planning/.tpac/<milestone>.json` for the dashboard's
 * TpacPanel to consume.
 *
 * **Cassette installation is best-effort.** `installReplay()` patches
 * the in-process undici dispatcher; `runVibe()` spawns a child process
 * that has its own dispatcher. The child will NOT see the in-process
 * cassettes today. Tests that need real HTTP replay in the child are
 * gated behind `describe.skipIf(...)` until Phase 6 wires cross-process
 * cassette inheritance (env-var bootstrap on the child). Until then,
 * `runMilestone` returns the harvested artefacts the spawned cook
 * produces — which, in CI, is whatever cook can do without real LLM
 * calls (usually exit non-zero with empty planning tree).
 *
 * Two consumers:
 *   - `swt bench` (`packages/cli/src/commands/bench.ts`) — feeds the
 *     returned `meterSnapshot` + `criteriaSatisfied` into
 *     `computeTpac()` for the printed report.
 *   - `test/regression/ref-fastapi-milestone.test.ts` (plan 05-04 T4) —
 *     diffs the produced `.swt-planning/` against the v2-baseline tree.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runVibe, type RunVibeResult } from '@swt-labs/methodology';
import {
  computeTpac,
  countSatisfiedCriteria,
  liftMeterSnapshot,
} from '@swt-labs/orchestration';
import type { MeterSnapshot, TpacReport } from '@swt-labs/shared';

import { installReplay, type ReplayHandle } from './cassettes/replayer.js';

export interface RunMilestoneOptions {
  /** Absolute path to a fixture directory containing `spec/` + `cassettes/`. */
  readonly fixture: string;
  /** Optional override for the cassette directory (default: `<fixture>/cassettes`). */
  readonly cassettesDir?: string;
  /** Optional override for the spec directory (default: `<fixture>/spec`). */
  readonly specDir?: string;
  /** Optional milestone label used for the TPAC report + meter records (default: `'M2'`). */
  readonly milestone?: string;
  /** Optional fixture identifier echoed into the TpacReport (default: derived from `fixture`). */
  readonly fixtureId?: string;
  /**
   * When set, write the computed TpacReport to
   * `<planningRoot>/.tpac/<milestone>.json` for the dashboard's
   * TpacPanel. Defaults to `true`.
   */
  readonly writeTpacJson?: boolean;
  /** Override the swt CLI bundle path forwarded to `runVibe`. */
  readonly swtBin?: string;
  /** Override the spawn timeout (forwarded to `runVibe`). */
  readonly spawnTimeoutMs?: number;
  /** Override the default provider applied to lifted records. */
  readonly defaultProvider?: string;
  /** Override the default model applied to lifted records. */
  readonly defaultModel?: string;
}

export interface RunMilestoneResult {
  /** Absolute path to the tmpdir where the milestone artefacts were written. */
  readonly artefactsPath: string;
  /** List of cassette names that were activated for the run (file basenames without `.jsonl`). */
  readonly cassettesActivated: ReadonlyArray<string>;
  /**
   * Replay handles — the caller MUST call `uninstall()` on each (or use
   * `disposeRun()` below) to restore the previous undici dispatcher.
   * Without this the next test in the file inherits the interceptor and
   * sees spurious "request not in cassette" failures.
   */
  readonly replayHandles: ReadonlyArray<ReplayHandle>;
  /** Token meter snapshot lifted from the produced `.swt-planning/.metrics/`. */
  readonly meterSnapshot: MeterSnapshot;
  /**
   * Sum of `passed:` across every `phases/<NN>-.../<NN>-VERIFICATION.md`.
   * Becomes the `computeTpac()` denominator.
   */
  readonly criteriaSatisfied: number;
  /** Validated TpacReport (when `criteriaSatisfied > 0`; otherwise `undefined`). */
  readonly tpacReport: TpacReport | undefined;
  /** Raw result of the spawned `runVibe()` call. */
  readonly runVibeResult: RunVibeResult;
}

export class CassetteNotRecordedError extends Error {
  constructor(cassettesDir: string) {
    super(
      `No cassettes found at ${cassettesDir}. The regression suite requires ` +
        `recorded Anthropic cassettes. Record them via the workflow at ` +
        `docs/operations/cassette-recording.md ("Recording the ref-fastapi-empty ` +
        `cassettes for the M2 regression baseline").`,
    );
    this.name = 'CassetteNotRecordedError';
  }
}

/**
 * Run a recorded milestone against the v3 methodology in a tmpdir.
 *
 * Steps:
 *   1. Copy `<fixture>/spec/` into a fresh tmpdir.
 *   2. Install every `<fixture>/cassettes/*.jsonl` via `installReplay`.
 *   3. Invoke `runVibe({ cwd: tmpRoot, milestone, ... })`.
 *   4. Lift the produced `.metrics/` into a `MeterSnapshot`.
 *   5. Compute a `TpacReport` (skipped when criteriaSatisfied === 0).
 *   6. Optionally write the report to `.tpac/<milestone>.json`.
 *
 * Throws `CassetteNotRecordedError` when no cassettes are present —
 * regression callers should `describe.skipIf(...)` before invoking
 * rather than catch.
 */
export async function runMilestone(opts: RunMilestoneOptions): Promise<RunMilestoneResult> {
  const cassettesDir = opts.cassettesDir ?? join(opts.fixture, 'cassettes');
  const specDir = opts.specDir ?? join(opts.fixture, 'spec');

  if (!directoryHasCassettes(cassettesDir)) {
    throw new CassetteNotRecordedError(cassettesDir);
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'swt-runmilestone-'));
  cpSync(specDir, tmpRoot, { recursive: true });

  const cassetteFiles = listCassettes(cassettesDir);
  const replayHandles: ReplayHandle[] = [];
  for (const cassettePath of cassetteFiles) {
    replayHandles.push(installReplay(cassettePath));
  }
  const cassettesActivated = cassetteFiles.map(basenameWithoutExt);

  const milestone = opts.milestone ?? 'M2';
  const fixtureId = opts.fixtureId ?? basenameOf(opts.fixture);

  const runVibeResult = await runVibe({
    cwd: tmpRoot,
    milestone,
    nonInteractive: true,
    ...(opts.swtBin !== undefined ? { swtBin: opts.swtBin } : {}),
    ...(opts.spawnTimeoutMs !== undefined ? { spawnTimeoutMs: opts.spawnTimeoutMs } : {}),
    ...(opts.defaultProvider !== undefined ? { defaultProvider: opts.defaultProvider } : {}),
    ...(opts.defaultModel !== undefined ? { defaultModel: opts.defaultModel } : {}),
  });

  // Re-lift from disk so the result reflects whatever the child actually
  // wrote (the child runs in a subprocess; `runVibeResult.meterSnapshot`
  // already lifted, but a later `swt bench --verbose` may want to lift
  // again with a different milestone label).
  const meterSnapshot = liftMeterSnapshot({
    planningRoot: runVibeResult.planningRoot,
    milestone,
    ...(opts.defaultProvider !== undefined ? { defaultProvider: opts.defaultProvider } : {}),
    ...(opts.defaultModel !== undefined ? { defaultModel: opts.defaultModel } : {}),
  });
  const criteriaSatisfied = countSatisfiedCriteria(runVibeResult.planningRoot);

  let tpacReport: TpacReport | undefined;
  if (criteriaSatisfied > 0) {
    tpacReport = computeTpac(meterSnapshot, {
      milestone,
      fixture: fixtureId,
      criteria_satisfied: criteriaSatisfied,
    });
    if (opts.writeTpacJson !== false) {
      const tpacDir = join(runVibeResult.planningRoot, '.tpac');
      mkdirSync(tpacDir, { recursive: true });
      writeFileSync(
        join(tpacDir, `${milestone}.json`),
        `${JSON.stringify(tpacReport, null, 2)}\n`,
        'utf-8',
      );
    }
  }

  return {
    artefactsPath: tmpRoot,
    cassettesActivated,
    replayHandles,
    meterSnapshot,
    criteriaSatisfied,
    tpacReport,
    runVibeResult,
  };
}

/**
 * Tear down a `runMilestone` result — uninstalls every replay handle.
 * Tests should call this in `afterEach` to avoid interceptor leak.
 */
export function disposeRun(result: RunMilestoneResult): void {
  for (const handle of result.replayHandles) {
    try {
      handle.uninstall();
    } catch {
      // best-effort tear-down; never throw out of afterEach
    }
  }
}

function directoryHasCassettes(dir: string): boolean {
  try {
    const entries = readdirSync(dir);
    return entries.some((e) => e.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

function listCassettes(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.jsonl'))
    .map((e) => join(dir, e))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function basenameWithoutExt(p: string): string {
  const base = basenameOf(p);
  return base.replace(/\.jsonl$/, '');
}

function basenameOf(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? norm : norm.slice(idx + 1);
}

// Reference `existsSync` so the unused-import linter does not strip the
// node:fs import (existsSync is reserved for the dashboard `.tpac/` panel
// future-tap; keeping it loaded here so the tests can construct a fake
// runMilestone result without importing it again).
void existsSync;
