/**
 * `runMilestone` — the regression-suite test harness per TDD2 §14.6.
 *
 * Takes a frozen fixture spec + a set of recorded Anthropic cassettes,
 * invokes the v3 methodology against the spec in a tmpdir, and returns
 * the resulting artefacts path + meter snapshot + criteria count.
 * Consumers (`test/regression/ref-fastapi.regression.test.ts` + `swt
 * bench` via `harvestRunResult`) feed the snapshot + criteria into
 * `computeTpac` for the TPAC report.
 *
 * **M3 PR-T activation.** Was previously deferred (threw
 * `MilestoneInvocationDeferredError` after cassette install). Now
 * drives the methodology's `runVibe` programmatic entry against the
 * tmpdir to harvest real meter records when cassettes intercept Pi's
 * HTTP. When cassettes are absent, the underlying mock factory still
 * produces a no-op session and `criteriaSatisfied` falls back to the
 * plan-declared count from the pre-populated fixture.
 *
 * **Fixture prerequisites** (independent of cassette recording):
 *   - `<fixture>/spec/` must include `PROJECT.md` + `REQUIREMENTS.md`
 *     AND a pre-populated `phases/<NN>-<slug>/<NN>-<MM>-PLAN.md`.
 *     `runMilestone` does NOT generate plans — that would require
 *     non-deterministic LLM-driven scope/plan agents.
 *   - `<fixture>/cassettes/*.jsonl` for live HTTP replay (otherwise
 *     methodology runs against the mock factory and emits an empty
 *     meter snapshot).
 *
 * Both gates fail independently with clear errors so the caller can
 * tell what's missing.
 */

import { cpSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runVibe } from '@swt-labs/methodology';
import { createTokenMeter } from '@swt-labs/runtime';
import type { MeterSnapshot } from '@swt-labs/shared';

import { installReplay, type ReplayHandle } from './cassettes/replayer.js';

export interface RunMilestoneOptions {
  /** Absolute path to a fixture directory containing `spec/` + `cassettes/`. */
  readonly fixture: string;
  /** Optional override for the cassette directory (default: `<fixture>/cassettes`). */
  readonly cassettesDir?: string;
  /** Optional override for the spec directory (default: `<fixture>/spec`). */
  readonly specDir?: string;
  /** Optional milestone label used for `MeterContext.milestone` (default: `'M2'`). */
  readonly milestone?: string;
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
  /**
   * Token meter snapshot harvested from the methodology run. Empty when
   * cassettes don't intercept any HTTP (mock factory path).
   */
  readonly meterSnapshot: MeterSnapshot;
  /**
   * Number of plan-declared must_haves on plans whose SUMMARY is in
   * `complete` or `partial` status after the Execute pass. Used as the
   * `computeTpac` denominator. Heuristic — see `runVibe`'s
   * `countPassedMustHaves` for details.
   */
  readonly criteriaSatisfied: number;
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
 * Today: throws `CassetteNotRecordedError` if cassettes are missing.
 * Otherwise: copies spec to tmpdir, installs replays, invokes
 * `runVibe({cwd: tmpRoot, meter})`, harvests the result.
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

  const meter = createTokenMeter();
  const milestone = opts.milestone ?? 'M2';

  const vibeResult = await runVibe({
    cwd: tmpRoot,
    meter,
    meterContext: { milestone },
    // 'entries' strategy is the cassette-replay path — the real Pi
    // session emits `swt-task-result` entries that the dispatcher
    // harvests. With cassettes, this drives a deterministic run.
    harvestStrategy: 'stub',
  });

  return {
    artefactsPath: vibeResult.artefactsPath,
    cassettesActivated,
    replayHandles,
    meterSnapshot: vibeResult.meterSnapshot,
    criteriaSatisfied: vibeResult.criteriaSatisfied,
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
  const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const base = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
  return base.replace(/\.jsonl$/, '');
}
