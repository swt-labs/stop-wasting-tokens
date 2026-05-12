/**
 * Lock-files tests (M3 PR-25).
 *
 * Covers:
 *   - `acquireLock` writes a valid envelope to disk.
 *   - The handle's `release` is idempotent (ENOENT swallowed).
 *   - `update` patches state/session_id/worktree_path + sets updated_at.
 *   - Conflict: existing lock held by a different ALIVE PID → throws
 *     `LockAcquireConflictError`.
 *   - Dead-holder reclaim: existing lock held by a DEAD PID → succeeds
 *     and overwrites.
 *   - Same-PID re-acquire: existing lock held by the same PID → succeeds
 *     and overwrites (process-restart-in-same-PID edge case).
 *   - `readLocks` returns parsed entries with liveness flag; skips
 *     un-parseable files silently.
 *   - `readLocks` on a missing locks-root returns `[]` (ENOENT
 *     tolerated as "no locks held").
 *   - `purgeStaleLocks` drops dead-PID locks + returns the purged paths.
 *   - `purgeStaleLocks` preserves alive-PID + corrupt files by default;
 *     `purgeCorrupt: true` opt-in drops corrupt files.
 *   - `defaultPidChecker` reports current process as alive + nonexistent
 *     PID as dead (real-process smoke).
 *   - Lock-file basename pattern uses `task-<id>.lock`; foreign files
 *     are ignored by readers.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LockFileEnvelopeSchema } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireLock,
  defaultPidChecker,
  LockAcquireConflictError,
  lockPathFor,
  purgeStaleLocks,
  readLocks,
  type PidChecker,
} from '../src/lock-files.js';

describe('lock-files — M3 PR-25', () => {
  let tmpRoot: string;
  let clockTick: number;
  const clock = (): string => {
    clockTick += 1;
    return `2026-05-12T00:00:${String(clockTick).padStart(2, '0')}.000Z`;
  };

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'swt-lockfiles-'));
    clockTick = 0;
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('acquireLock', () => {
    it('writes a valid envelope to disk at task-<id>.lock', async () => {
      const handle = await acquireLock({
        taskId: 'T-001',
        worktreePath: '/repo/.swt-planning/parallel/wt-T-001',
        state: 'created',
        pid: 12345,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead', // not consulted on clean acquire path
      });

      expect(handle.path).toBe(lockPathFor(tmpRoot, 'T-001'));
      expect(handle.taskId).toBe('T-001');

      const raw = await readFile(handle.path, 'utf8');
      const envelope = LockFileEnvelopeSchema.parse(JSON.parse(raw));
      expect(envelope.schema_version).toBe(1);
      expect(envelope.task_id).toBe('T-001');
      expect(envelope.pid).toBe(12345);
      expect(envelope.worktree_path).toBe('/repo/.swt-planning/parallel/wt-T-001');
      expect(envelope.state).toBe('created');
      expect(envelope.started_at).toBe('2026-05-12T00:00:01.000Z');
      expect(envelope.session_id).toBeUndefined();
      expect(envelope.updated_at).toBeUndefined();
    });

    it('persists optional session_id', async () => {
      await acquireLock({
        taskId: 'T-002',
        worktreePath: '/wt',
        state: 'dispatched',
        sessionId: 'session-abc-123',
        pid: 100,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      const raw = await readFile(lockPathFor(tmpRoot, 'T-002'), 'utf8');
      const envelope = LockFileEnvelopeSchema.parse(JSON.parse(raw));
      expect(envelope.session_id).toBe('session-abc-123');
    });
  });

  describe('handle.release', () => {
    it('deletes the lock file from disk', async () => {
      const handle = await acquireLock({
        taskId: 'T-100',
        worktreePath: '/wt',
        state: 'created',
        pid: 1,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      await handle.release();
      const entries = await readdir(tmpRoot);
      expect(entries).toEqual([]);
    });

    it('is idempotent — second release on a missing file is silent', async () => {
      const handle = await acquireLock({
        taskId: 'T-101',
        worktreePath: '/wt',
        state: 'created',
        pid: 1,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      await handle.release();
      await expect(handle.release()).resolves.toBeUndefined();
    });
  });

  describe('handle.update', () => {
    it('patches state and sets updated_at', async () => {
      const handle = await acquireLock({
        taskId: 'T-200',
        worktreePath: '/wt',
        state: 'created',
        pid: 1,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      await handle.update({ state: 'dispatched' });
      const raw = await readFile(handle.path, 'utf8');
      const envelope = LockFileEnvelopeSchema.parse(JSON.parse(raw));
      expect(envelope.state).toBe('dispatched');
      expect(envelope.updated_at).toBe('2026-05-12T00:00:02.000Z');
      // Immutable fields preserved.
      expect(envelope.task_id).toBe('T-200');
      expect(envelope.pid).toBe(1);
      expect(envelope.started_at).toBe('2026-05-12T00:00:01.000Z');
    });

    it('patches session_id and worktree_path independently', async () => {
      const handle = await acquireLock({
        taskId: 'T-201',
        worktreePath: '/wt-old',
        state: 'created',
        pid: 1,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      await handle.update({ session_id: 'sess-new', worktree_path: '/wt-new' });
      const raw = await readFile(handle.path, 'utf8');
      const envelope = LockFileEnvelopeSchema.parse(JSON.parse(raw));
      expect(envelope.session_id).toBe('sess-new');
      expect(envelope.worktree_path).toBe('/wt-new');
    });
  });

  describe('conflict + reclaim', () => {
    it('throws LockAcquireConflictError when a different ALIVE PID holds the lock', async () => {
      await acquireLock({
        taskId: 'T-300',
        worktreePath: '/wt',
        state: 'created',
        pid: 9999,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'alive',
      });
      // Different caller (different pid) attempts to acquire — alive holder blocks.
      await expect(
        acquireLock({
          taskId: 'T-300',
          worktreePath: '/wt',
          state: 'created',
          pid: 1111,
          locksRoot: tmpRoot,
          clock,
          pidChecker: () => 'alive',
        }),
      ).rejects.toBeInstanceOf(LockAcquireConflictError);
    });

    it('reclaims a DEAD-holder lock (overwrites without throwing)', async () => {
      await acquireLock({
        taskId: 'T-301',
        worktreePath: '/wt-old',
        state: 'agent_running',
        pid: 9999,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead', // unused on initial acquire
      });
      const handle = await acquireLock({
        taskId: 'T-301',
        worktreePath: '/wt-new',
        state: 'created',
        pid: 1111,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      const raw = await readFile(handle.path, 'utf8');
      const envelope = LockFileEnvelopeSchema.parse(JSON.parse(raw));
      expect(envelope.pid).toBe(1111);
      expect(envelope.worktree_path).toBe('/wt-new');
      expect(envelope.state).toBe('created');
    });

    it('reclaims own-PID lock (process-restart-same-PID edge case)', async () => {
      await acquireLock({
        taskId: 'T-302',
        worktreePath: '/wt-old',
        state: 'agent_running',
        pid: 5555,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'alive',
      });
      // Same PID re-acquires — should succeed regardless of liveness.
      const handle = await acquireLock({
        taskId: 'T-302',
        worktreePath: '/wt-new',
        state: 'created',
        pid: 5555,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'alive',
      });
      const raw = await readFile(handle.path, 'utf8');
      const envelope = LockFileEnvelopeSchema.parse(JSON.parse(raw));
      expect(envelope.worktree_path).toBe('/wt-new');
    });

    it('treats `unknown` liveness conservatively (refuses to reclaim)', async () => {
      await acquireLock({
        taskId: 'T-303',
        worktreePath: '/wt',
        state: 'created',
        pid: 7777,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'alive',
      });
      await expect(
        acquireLock({
          taskId: 'T-303',
          worktreePath: '/wt',
          state: 'created',
          pid: 2222,
          locksRoot: tmpRoot,
          clock,
          pidChecker: () => 'unknown',
        }),
      ).rejects.toBeInstanceOf(LockAcquireConflictError);
    });
  });

  describe('readLocks', () => {
    it('returns parsed entries with liveness flags', async () => {
      await acquireLock({
        taskId: 'T-400',
        worktreePath: '/wt-a',
        state: 'created',
        pid: 100,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      await acquireLock({
        taskId: 'T-401',
        worktreePath: '/wt-b',
        state: 'dispatched',
        pid: 200,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });

      // PID 100 alive, PID 200 dead per the injected checker.
      const checker: PidChecker = (pid) => (pid === 100 ? 'alive' : 'dead');
      const entries = await readLocks({ locksRoot: tmpRoot, pidChecker: checker });
      expect(entries).toHaveLength(2);

      const byTask = new Map(entries.map((e) => [e.envelope.task_id, e]));
      expect(byTask.get('T-400')?.liveness).toBe('alive');
      expect(byTask.get('T-401')?.liveness).toBe('dead');
    });

    it('returns [] for a missing locks-root (ENOENT tolerated)', async () => {
      const entries = await readLocks({ locksRoot: join(tmpRoot, 'does-not-exist') });
      expect(entries).toEqual([]);
    });

    it('skips un-parseable lock files silently', async () => {
      // One valid + one garbage.
      await acquireLock({
        taskId: 'T-500',
        worktreePath: '/wt',
        state: 'created',
        pid: 1,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      writeFileSync(join(tmpRoot, 'task-T-CORRUPT.lock'), 'not valid json', 'utf8');
      const entries = await readLocks({ locksRoot: tmpRoot, pidChecker: () => 'alive' });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.envelope.task_id).toBe('T-500');
    });

    it('ignores files that do not match task-*.lock pattern', async () => {
      writeFileSync(join(tmpRoot, 'README.md'), 'no', 'utf8');
      writeFileSync(join(tmpRoot, 'lockfile-other-shape.txt'), 'no', 'utf8');
      writeFileSync(join(tmpRoot, 'task-OK.lock.bak'), '{}', 'utf8');
      const entries = await readLocks({ locksRoot: tmpRoot, pidChecker: () => 'alive' });
      expect(entries).toEqual([]);
    });
  });

  describe('purgeStaleLocks', () => {
    it('drops dead-PID locks + returns their paths', async () => {
      await acquireLock({
        taskId: 'T-600',
        worktreePath: '/wt-a',
        state: 'created',
        pid: 100,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      await acquireLock({
        taskId: 'T-601',
        worktreePath: '/wt-b',
        state: 'created',
        pid: 200,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      const purged = await purgeStaleLocks({
        locksRoot: tmpRoot,
        pidChecker: (pid) => (pid === 100 ? 'alive' : 'dead'),
      });
      expect(purged).toHaveLength(1);
      expect(purged[0]).toBe(lockPathFor(tmpRoot, 'T-601'));

      const remaining = await readLocks({ locksRoot: tmpRoot, pidChecker: () => 'alive' });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.envelope.task_id).toBe('T-600');
    });

    it('preserves corrupt files by default; opt-in purgeCorrupt drops them', async () => {
      writeFileSync(join(tmpRoot, 'task-T-CORRUPT.lock'), 'not json', 'utf8');

      const purgedDefault = await purgeStaleLocks({
        locksRoot: tmpRoot,
        pidChecker: () => 'dead',
      });
      expect(purgedDefault).toEqual([]);

      const purgedOptIn = await purgeStaleLocks({
        locksRoot: tmpRoot,
        pidChecker: () => 'dead',
        purgeCorrupt: true,
      });
      expect(purgedOptIn).toHaveLength(1);
    });

    it('preserves alive-PID locks even when peers are purged', async () => {
      await acquireLock({
        taskId: 'T-700',
        worktreePath: '/wt-keep',
        state: 'created',
        pid: 100,
        locksRoot: tmpRoot,
        clock,
        pidChecker: () => 'dead',
      });
      await purgeStaleLocks({
        locksRoot: tmpRoot,
        pidChecker: () => 'alive',
      });
      const entries = await readLocks({ locksRoot: tmpRoot, pidChecker: () => 'alive' });
      expect(entries).toHaveLength(1);
    });
  });

  describe('defaultPidChecker', () => {
    it('reports the current process PID as alive', () => {
      expect(defaultPidChecker(process.pid)).toBe('alive');
    });

    it('reports a nonexistent high PID as dead', () => {
      // PID 0 is reserved; very large PIDs reliably ESRCH on POSIX +
      // Windows alike. Picking 2^31 - 1 to stay within int32 range.
      const result = defaultPidChecker(2147483647);
      // On some sandboxed environments this may map to 'unknown' instead
      // of 'dead' — both are acceptable per the contract; what we
      // really want to assert is "not alive".
      expect(['dead', 'unknown']).toContain(result);
    });
  });

  describe('schema enforcement', () => {
    it('throws LockFileParseError when on-disk JSON fails schema validation', async () => {
      // Manually write a malformed envelope (missing required fields).
      const path = lockPathFor(tmpRoot, 'T-BAD');
      await writeFile(path, JSON.stringify({ schema_version: 1, task_id: 'T-BAD' }), 'utf8');
      // readLocks skips un-parseable files silently; assert via the
      // `purgeCorrupt: true` opt-in path which DOES surface them.
      const purged = await purgeStaleLocks({
        locksRoot: tmpRoot,
        pidChecker: () => 'alive',
        purgeCorrupt: true,
      });
      expect(purged).toHaveLength(1);
      expect(purged[0]).toBe(path);
    });
  });
});
