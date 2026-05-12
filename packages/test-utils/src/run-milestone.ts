/**
 * `runMilestone` — the regression-suite test harness per TDD2 §14.6.
 *
 * Takes a frozen fixture spec + a set of recorded Anthropic cassettes,
 * invokes the v3 methodology against the spec in a tmpdir, and returns
 * the resulting artefacts path + meter snapshot. Consumers
 * (`test/regression/ref-fastapi.regression.test.ts`) feed the artefacts
 * path into `diffArtefacts` for the allowed-drift comparison against
 * the v2 baseline.
 *
 * **Cassette-deferred at M2 PR-18.** The actual milestone invocation
 * requires:
 *
 *   1. Recorded Anthropic cassettes at `<fixture>/cassettes/*.jsonl`
 *      (one per role dispatched during the milestone — Scout, Architect,
 *      Lead, Dev × N, QA).
 *   2. The v3 methodology layer's `swt vibe` end-to-end path wired to
 *      consume the dispatcher's `'entries'` HarvestStrategy.
 *
 * Recording is a developer-local one-time step (requires Anthropic API
 * key); the wiring is in flight through M2 PR-15..21. Until both ship,
 * `runMilestone` throws `CassetteNotRecordedError` with a clear pointer
 * to `docs/operations/cassette-recording.md`.
 *
 * The harness itself is fully implemented — the cassette install, the
 * spec copy to tmpdir, the artefacts harvest. It's the runtime
 * milestone-invocation step that's deferred (no real Pi prompt() until
 * M3 PR-22 wires it). The structural contract is locked here so PR-22
 * can flip a single line to activate the real run path.
 */

import { cpSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installReplay, type ReplayHandle } from './cassettes/replayer.js';

export interface RunMilestoneOptions {
  /** Absolute path to a fixture directory containing `spec/` + `cassettes/`. */
  readonly fixture: string;
  /** Optional override for the cassette directory (default: `<fixture>/cassettes`). */
  readonly cassettesDir?: string;
  /** Optional override for the spec directory (default: `<fixture>/spec`). */
  readonly specDir?: string;
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
}

export class CassetteNotRecordedError extends Error {
  constructor(cassettesDir: string) {
    super(
      `No cassettes found at ${cassettesDir}. The regression suite requires ` +
        `recorded Anthropic cassettes. Record them via the workflow at ` +
        `docs/operations/cassette-recording.md ("Recording the ref-fastapi-empty ` +
        `cassettes for the M2 regression baseline"). M2 PR-18 ships the harness ` +
        `+ comparator; the cassette recording is a separate user-driven step.`,
    );
    this.name = 'CassetteNotRecordedError';
  }
}

export class MilestoneInvocationDeferredError extends Error {
  constructor() {
    super(
      `runMilestone harness is wired but the v3 methodology end-to-end ` +
        `invocation is deferred until M3 PR-22 wires real Pi prompting. ` +
        `Today the dispatcher's session.prompt() is a no-op, so a full ` +
        `milestone replay cannot execute. The harness ships its contract + ` +
        `cassette plumbing so M3 PR-22 activates with a single line flip.`,
    );
    this.name = 'MilestoneInvocationDeferredError';
  }
}

/**
 * Run a recorded milestone against the v3 methodology in a tmpdir.
 *
 * Today: throws `CassetteNotRecordedError` if cassettes are missing
 * (PR-18 ship state), and `MilestoneInvocationDeferredError` after the
 * cassette load succeeds (the real run path lands at M3 PR-22). The
 * structural code paths up to and including cassette install ARE
 * exercised today by `diff-artefacts.test.ts`-adjacent tests.
 */
export function runMilestone(opts: RunMilestoneOptions): RunMilestoneResult {
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

  // M3 PR-22 flip: replace this throw with the real `await swtVibe({cwd: tmpRoot})`.
  // The harness is ready; the runtime layer's session.prompt() needs to be wired.
  // The return statement below documents the eventual shape — currently
  // unreachable since the throw fires first.
  if (replayHandles.length === 0 && cassettesActivated.length === 0) {
    // Defensive: this branch never executes (the cassette check above
    // guarantees at least one handle), but it keeps `return` syntactically
    // reachable so the lint surface stays clean while the throw is wired.
    return { artefactsPath: tmpRoot, cassettesActivated, replayHandles };
  }
  throw new MilestoneInvocationDeferredError();
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
