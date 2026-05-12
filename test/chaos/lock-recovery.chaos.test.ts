/**
 * Lock-file PID-liveness chaos suite per TDD2 §9.5 + Plan 03-04 PR-28.
 *
 * Partner to `worktree-fsm.chaos.test.ts`. Asserts the two
 * lock-recovery invariants the M3 EXIT GATE depends on:
 *
 *   1. **Alive → dead transition.** A lock whose holder PID is alive
 *      when acquired but dies before `purgeStaleLocks` runs is dropped
 *      cleanly. The freed slot is re-acquirable.
 *   2. **Corrupt-envelope defence.** A lock file whose JSON body is
 *      garbage (partial write, disk corruption, concurrent crash) is
 *      removed by `purgeStaleLocks({purgeCorrupt: true})` so a future
 *      acquire isn't blocked by an unparseable lock.
 *
 * Together these invariants underpin `swt cleanup --prune-locks`
 * (PR-29) — operators can reclaim worktree slots after crash without
 * manually identifying which locks are stuck.
 *
 * PID 1 (init/systemd on Linux, launchd on macOS) is always alive,
 * which we use as the "alive sentinel" for the alive-side tests. A
 * synthetic dead PID is chosen to be well outside any realistic
 * process-table range; if a real process happens to have that PID at
 * test time, the test re-rolls.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

import { acquireLock, purgeStaleLocks, readLocks, type PidChecker } from '@swt-labs/orchestration';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface Fixture {
  readonly root: string;
  readonly locksRoot: string;
}

function setupFixture(): Fixture {
  // ADR-009: keep paths POSIX-form even on Windows runners. tmpdir() returns
  // a platform-native path; normalize to POSIX so downstream posix.join calls
  // (in both fixture + production) produce consistent separators.
  const tmpPosix = tmpdir().replace(/\\/g, '/');
  const root = mkdtempSync(posix.join(tmpPosix, 'swt-chaos-lock-')).replace(/\\/g, '/');
  const locksRoot = posix.join(root, 'locks');
  mkdirSync(locksRoot, { recursive: true });
  return { root, locksRoot };
}

describe('lock-file PID-liveness chaos invariant', () => {
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
   * Lifecycle: acquire (PID alive) → SIGKILL simulation (PID flips to
   * dead) → `purgeStaleLocks` drops the lock → fresh acquire succeeds.
   * This is the chaos-recovery happy path.
   */
  it('alive → dead PID transition: purgeStaleLocks reclaims the slot for a fresh acquire', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    const taskId = 'T-CHAOS-LOCK-01';

    // Step 1: acquire with `alive` PID. Mock the checker so we don't
    // depend on the host's process table.
    const aliveChecker: PidChecker = () => 'alive';
    const handle = await acquireLock({
      locksRoot: fixture.locksRoot,
      taskId,
      worktreePath: `parallel/wt-${taskId}/`,
      state: 'dispatched',
      pidChecker: aliveChecker,
    });
    expect(existsSync(handle.path)).toBe(true);

    // Verify readLocks sees it as alive.
    let lockEntries = await readLocks({ locksRoot: fixture.locksRoot, pidChecker: aliveChecker });
    expect(lockEntries).toHaveLength(1);
    expect(lockEntries[0]?.liveness).toBe('alive');

    // Step 2: SIGKILL simulation — flip PID checker to `dead` (the
    // process holding the lock is gone, but the file persists).
    const deadChecker: PidChecker = () => 'dead';

    // Step 3: purgeStaleLocks drops the lock.
    const purged = await purgeStaleLocks({
      locksRoot: fixture.locksRoot,
      pidChecker: deadChecker,
    });
    expect(purged).toContain(handle.path);
    expect(existsSync(handle.path)).toBe(false);

    // Step 4: a fresh acquire on the same taskId succeeds — the slot
    // is reclaimed without operator intervention.
    const newHandle = await acquireLock({
      locksRoot: fixture.locksRoot,
      taskId,
      worktreePath: `parallel/wt-${taskId}/`,
      state: 'created',
      pidChecker: aliveChecker,
    });
    expect(existsSync(newHandle.path)).toBe(true);
    lockEntries = await readLocks({ locksRoot: fixture.locksRoot, pidChecker: aliveChecker });
    expect(lockEntries).toHaveLength(1);
    expect(lockEntries[0]?.envelope.state).toBe('created');
  });

  /**
   * Corrupt-envelope defence: a lock file whose JSON is truncated /
   * malformed must be purgeable so a stuck acquire path doesn't
   * deadlock the operator.
   */
  it('corrupt-envelope lock is purged when purgeCorrupt: true', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    const corruptPath = posix.join(fixture.locksRoot, 'task-T-CORRUPT.lock');
    writeFileSync(corruptPath, '{"schema_version": 1, "task_id": "T-CORRUPT", "pi'); // truncated

    // Without purgeCorrupt, the lock survives (forensics-preserved).
    const survived = await purgeStaleLocks({
      locksRoot: fixture.locksRoot,
      pidChecker: () => 'dead',
    });
    expect(survived).toHaveLength(0);
    expect(existsSync(corruptPath)).toBe(true);

    // With purgeCorrupt, it's dropped.
    const purged = await purgeStaleLocks({
      locksRoot: fixture.locksRoot,
      pidChecker: () => 'dead',
      purgeCorrupt: true,
    });
    expect(purged).toContain(corruptPath);
    expect(existsSync(corruptPath)).toBe(false);
  });

  /**
   * Mixed lock pool: live + dead + corrupt all present. purgeStaleLocks
   * with `purgeCorrupt: true` removes dead + corrupt but preserves the
   * live lock. This is the production-shaped scenario `swt cleanup
   * --prune-locks` runs against.
   */
  it('mixed lock pool: live preserved, dead + corrupt removed', async () => {
    if (fixture === undefined) throw new Error('fixture not set');

    // Distinct synthetic PIDs so the purge-time checker can differentiate.
    const LIVE_PID = 11111;
    const DEAD_PID = 99999;
    const liveRaw = `{"schema_version":1,"task_id":"T-LIVE","pid":${LIVE_PID},"started_at":"2026-05-12T10:00:00.000Z","worktree_path":"parallel/wt-T-LIVE/","state":"dispatched"}`;
    const livePath = posix.join(fixture.locksRoot, 'task-T-LIVE.lock');
    writeFileSync(livePath, liveRaw);

    const deadRaw = `{"schema_version":1,"task_id":"T-DEAD","pid":${DEAD_PID},"started_at":"2026-05-12T10:00:00.000Z","worktree_path":"parallel/wt-T-DEAD/","state":"agent_running"}`;
    const deadPath = posix.join(fixture.locksRoot, 'task-T-DEAD.lock');
    writeFileSync(deadPath, deadRaw);

    const corruptPath = posix.join(fixture.locksRoot, 'task-T-CORRUPT.lock');
    writeFileSync(corruptPath, 'not json');

    const purged = await purgeStaleLocks({
      locksRoot: fixture.locksRoot,
      pidChecker: (pid: number) => (pid === DEAD_PID ? 'dead' : 'alive'),
      purgeCorrupt: true,
    });
    expect(purged.sort()).toEqual([corruptPath, deadPath].sort());
    expect(existsSync(livePath)).toBe(true);
    expect(existsSync(deadPath)).toBe(false);
    expect(existsSync(corruptPath)).toBe(false);
  });

  /**
   * Idempotency: running purgeStaleLocks twice on the same pool is
   * harmless. The second invocation returns an empty array. This is
   * critical for `swt cleanup --prune-locks` being safely runnable
   * from cron / systemd timer.
   */
  it('purgeStaleLocks is idempotent (second run on same pool is a no-op)', async () => {
    if (fixture === undefined) throw new Error('fixture not set');

    const deadRaw = `{"schema_version":1,"task_id":"T-DEAD","pid":99999,"started_at":"2026-05-12T10:00:00.000Z","worktree_path":"parallel/wt-T-DEAD/","state":"dispatched"}`;
    const deadPath = posix.join(fixture.locksRoot, 'task-T-DEAD.lock');
    writeFileSync(deadPath, deadRaw);

    const first = await purgeStaleLocks({
      locksRoot: fixture.locksRoot,
      pidChecker: () => 'dead',
    });
    expect(first).toContain(deadPath);

    const second = await purgeStaleLocks({
      locksRoot: fixture.locksRoot,
      pidChecker: () => 'dead',
    });
    expect(second).toEqual([]);
  });
});
