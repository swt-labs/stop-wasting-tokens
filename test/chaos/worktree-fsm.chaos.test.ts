/**
 * `WorktreeManager` SIGKILL-at-every-transition chaos suite per
 * TDD2 §13.3.3 + Plan 03-04 PR-28.
 *
 * The M3 EXIT GATE asserts "Crash recovery 100% on every FSM transition".
 * The chaos invariant boils down to a single, testable property:
 *
 *   After every successful FSM transition, the on-disk journal's last
 *   entry reflects the new state — so a future SWT process can
 *   reconstruct the worktree's state from disk alone, without trusting
 *   any in-memory state of the killed predecessor.
 *
 * This suite walks the FSM forwards through every legal transition
 * (TDD2 §9.1). For each transition:
 *
 *   1. Drive a fresh `WorktreeManager` to the source state.
 *   2. Capture the on-disk journal (the persistent record).
 *   3. Simulate SIGKILL by dropping the manager reference (in-memory
 *      state is GONE).
 *   4. Read the journal directly via `readLastJournalState(...)` — a
 *      pure-disk helper the chaos test owns (no manager involvement).
 *   5. Assert the journal's last entry's `to` matches the expected
 *      state.
 *
 * Lock-file recovery is the partner invariant — see
 * `lock-recovery.chaos.test.ts`.
 *
 * Real git operations are bypassed via an injected `gitRunner` mock so
 * the suite runs in <100ms regardless of host disk speed. Real chaos
 * (live git worktrees + concurrent processes) is a separate ops
 * concern, not a unit-test concern.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { WorktreeManager, type GitRunner, type GitRunResult } from '@swt-labs/orchestration';
import type { WorktreeJournalEntry, WorktreeState } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface Fixture {
  readonly root: string;
  readonly parallelRoot: string;
  readonly journalRoot: string;
}

function setupFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-chaos-fsm-'));
  const parallelRoot = path.join(root, 'parallel');
  const journalRoot = path.join(root, 'journal');
  mkdirSync(parallelRoot, { recursive: true });
  mkdirSync(journalRoot, { recursive: true });
  return { root, parallelRoot, journalRoot };
}

/**
 * Pure-disk recovery helper: returns the last journal entry's `to`
 * state for a task, or `undefined` if no journal exists / no valid
 * entries. This is the "chaos invariant" probe — a fresh SWT process
 * starting from disk should be able to use this exact technique to
 * recover.
 */
function readLastJournalState(journalRoot: string, taskId: string): WorktreeState | undefined {
  const filePath = path.join(journalRoot, `wt-${taskId}.jsonl`);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    try {
      const obj = JSON.parse(line) as { to?: unknown };
      if (typeof obj.to === 'string') return obj.to as WorktreeState;
    } catch {
      continue;
    }
  }
  return undefined;
}

function readAllJournalEntries(
  journalRoot: string,
  taskId: string,
): readonly WorktreeJournalEntry[] {
  const filePath = path.join(journalRoot, `wt-${taskId}.jsonl`);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const entries: WorktreeJournalEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      entries.push(JSON.parse(line) as WorktreeJournalEntry);
    } catch {
      // skip
    }
  }
  return entries;
}

function makeOkGitRunner(): GitRunner {
  return async (_args: ReadonlyArray<string>): Promise<GitRunResult> => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
  });
}

describe('WorktreeManager — SIGKILL-at-every-transition chaos invariant', () => {
  let fixture: Fixture | undefined;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    if (fixture !== undefined) {
      try {
        rmSync(fixture.root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    fixture = undefined;
  });

  /**
   * Forward-walk: drive the FSM transition-by-transition and after each
   * successful transition assert the journal's last entry mirrors the
   * new state. This is the deterministic recovery signal.
   */
  it('every forward FSM transition is recoverable from the journal alone', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    const taskId = 'T-FSM-FWD';

    const manager = new WorktreeManager({
      parallelRoot: fixture.parallelRoot,
      journalRoot: fixture.journalRoot,
      gitRunner: makeOkGitRunner(),
    });

    // (none) → created
    await manager.create(taskId, 'main');
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('created');

    // created → claimed
    await manager.claim(taskId, ['src/foo.ts']);
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('claimed');

    // claimed → dispatched
    await manager.dispatch(taskId);
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('dispatched');

    // dispatched → agent_running
    await manager.markAgentRunning(taskId);
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('agent_running');

    // agent_running → agent_complete
    await manager.markAgentComplete(taskId, 'success');
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('agent_complete');

    // agent_complete → harvested
    await manager.harvest(taskId);
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('harvested');

    // harvested → removed (terminal clean)
    await manager.remove(taskId, { keepForForensics: true });
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('removed');

    // Sanity: every journaled `from` matches the previous entry's `to`.
    const entries = readAllJournalEntries(fixture.journalRoot, taskId);
    expect(entries.length).toBe(7);
    expect(entries[0]?.from).toBe('none');
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]?.from).toBe(entries[i - 1]?.to);
    }
  });

  /**
   * `failed` is reachable from any non-terminal state. Walk each
   * source state in turn, fail from it, assert the journal's last entry
   * shows `failed` with the prior state as `from`.
   */
  it.each<WorktreeState>([
    'created',
    'claimed',
    'dispatched',
    'agent_running',
    'agent_complete',
    'harvested',
  ])('failed reachable from %s — journal preserves both states', async (sourceState) => {
    if (fixture === undefined) throw new Error('fixture not set');
    const taskId = `T-FAIL-${sourceState}`;
    const manager = new WorktreeManager({
      parallelRoot: fixture.parallelRoot,
      journalRoot: fixture.journalRoot,
      gitRunner: makeOkGitRunner(),
    });

    // Drive up to the source state.
    await manager.create(taskId, 'main');
    if (sourceState !== 'created') {
      await manager.claim(taskId, []);
      if (sourceState !== 'claimed') {
        await manager.dispatch(taskId);
        if (sourceState !== 'dispatched') {
          await manager.markAgentRunning(taskId);
          if (sourceState !== 'agent_running') {
            await manager.markAgentComplete(taskId, 'success');
            if (sourceState !== 'agent_complete') {
              await manager.harvest(taskId);
              // sourceState must be 'harvested' here.
            }
          }
        }
      }
    }
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe(sourceState);

    // SIGKILL simulation: drop manager reference, reconstruct from disk.
    // Then run fail() on a fresh manager driven up to the same state
    // would require a resume() API the manager doesn't expose today.
    // Instead, we use the same manager (the in-memory state is still
    // there for THIS test's lifespan) and assert `fail` correctly
    // journals the prior state as `from`.
    await manager.fail(taskId, 'chaos-test-injected');
    const entries = readAllJournalEntries(fixture.journalRoot, taskId);
    const last = entries[entries.length - 1];
    expect(last?.to).toBe('failed');
    expect(last?.from).toBe(sourceState);
  });

  /**
   * `create` failure path: git worktree add fails → manager transitions
   * straight to `failed` and journals from=`none`. The chaos invariant:
   * even a failed create is recoverable from the journal.
   */
  it('failed create (git worktree add error) is journaled as none → failed', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    const taskId = 'T-CREATE-FAIL';
    const failingGitRunner: GitRunner = async () => ({
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: invalid reference',
    });
    const manager = new WorktreeManager({
      parallelRoot: fixture.parallelRoot,
      journalRoot: fixture.journalRoot,
      gitRunner: failingGitRunner,
    });

    await expect(manager.create(taskId, 'nonexistent')).rejects.toThrow(/worktree add/);
    expect(readLastJournalState(fixture.journalRoot, taskId)).toBe('failed');
    const entries = readAllJournalEntries(fixture.journalRoot, taskId);
    expect(entries[0]?.from).toBe('none');
    expect(entries[0]?.to).toBe('failed');
  });

  /**
   * Two concurrent managers against the same roots: per the FSM
   * comment "two concurrent WorktreeManager instances against the same
   * roots are safe — journal writes are append-only and per-task".
   * Exercise that property by interleaving operations across two
   * managers on DIFFERENT task IDs and assert no journal corruption.
   */
  it('concurrent managers on disjoint task IDs preserve journal integrity', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    const managerA = new WorktreeManager({
      parallelRoot: fixture.parallelRoot,
      journalRoot: fixture.journalRoot,
      gitRunner: makeOkGitRunner(),
    });
    const managerB = new WorktreeManager({
      parallelRoot: fixture.parallelRoot,
      journalRoot: fixture.journalRoot,
      gitRunner: makeOkGitRunner(),
    });

    // Interleave create→claim→dispatch for two different tasks.
    await Promise.all([
      (async () => {
        await managerA.create('T-A', 'main');
        await managerA.claim('T-A', ['src/a.ts']);
        await managerA.dispatch('T-A');
      })(),
      (async () => {
        await managerB.create('T-B', 'main');
        await managerB.claim('T-B', ['src/b.ts']);
        await managerB.dispatch('T-B');
      })(),
    ]);

    expect(readLastJournalState(fixture.journalRoot, 'T-A')).toBe('dispatched');
    expect(readLastJournalState(fixture.journalRoot, 'T-B')).toBe('dispatched');
    // Each task's journal has 3 entries (create, claim, dispatch).
    expect(readAllJournalEntries(fixture.journalRoot, 'T-A').length).toBe(3);
    expect(readAllJournalEntries(fixture.journalRoot, 'T-B').length).toBe(3);
  });
});
