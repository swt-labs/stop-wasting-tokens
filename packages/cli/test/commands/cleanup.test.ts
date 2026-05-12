/**
 * `swt cleanup` handler tests (M3 PR-29).
 *
 * Three modes:
 *   - default `--list` reads journal + lock files, prints a table
 *   - `--force --task-id <id>` runs `git worktree remove --force`, deletes
 *     the journal + lock for that task
 *   - `--prune-locks` delegates to `purgeStaleLocks` (which is exercised
 *     end-to-end here by mocking pidChecker)
 *
 * The git runner is injected so the force-remove path can be asserted
 * without spawning a real `git` binary.
 */

import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCleanupHandler } from '../../src/commands/cleanup.js';
import { EXIT } from '../../src/exit-codes.js';
import { StringStream } from '../_helpers.js';

interface Fixture {
  root: string;
  planningDir: string;
  journalDir: string;
  locksDir: string;
  parallelDir: string;
}

function setupPlanning(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-cleanup-'));
  const planningDir = path.join(root, '.swt-planning');
  const journalDir = path.join(planningDir, 'journal');
  const locksDir = path.join(planningDir, 'locks');
  const parallelDir = path.join(planningDir, 'parallel');
  mkdirSync(journalDir, { recursive: true });
  mkdirSync(locksDir, { recursive: true });
  mkdirSync(parallelDir, { recursive: true });
  return { root, planningDir, journalDir, locksDir, parallelDir };
}

function writeJournal(journalDir: string, taskId: string, state: string): void {
  const file = path.join(journalDir, `wt-${taskId}.jsonl`);
  writeFileSync(
    file,
    JSON.stringify({
      timestamp: '2026-05-12T10:00:00.000Z',
      taskId,
      from: 'none',
      to: state,
      details: {},
    }) + '\n',
  );
}

function writeLock(locksDir: string, taskId: string, pid: number): void {
  const file = path.join(locksDir, `task-${taskId}.lock`);
  writeFileSync(
    file,
    JSON.stringify({
      schema_version: 1,
      task_id: taskId,
      pid,
      worktree_path: `.swt-planning/parallel/wt-${taskId}/`,
      state: 'dispatched',
      started_at: '2026-05-12T10:00:00.000Z',
      updated_at: '2026-05-12T10:00:00.000Z',
    }),
  );
}

describe('createCleanupHandler', () => {
  let fixture: Fixture | undefined;

  beforeEach(() => {
    fixture = setupPlanning();
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
    vi.restoreAllMocks();
  });

  describe('--list (default)', () => {
    it('returns EXIT.NOT_IMPLEMENTED when .swt-planning/ is missing', async () => {
      const tmpRoot = mkdtempSync(path.join(tmpdir(), 'swt-cleanup-empty-'));
      const stdout = new StringStream();
      const stderr = new StringStream();
      const handler = createCleanupHandler();
      try {
        const exit = await handler(
          { verb: 'cleanup', positionals: [], flags: {} },
          { cwd: tmpRoot, stdout, stderr },
        );
        expect(exit).toBe(EXIT.NOT_IMPLEMENTED);
        expect(stderr.text()).toContain('no .swt-planning/');
        expect(stdout.text()).toBe('');
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it('prints "No active worktrees" when journal + locks are empty', async () => {
      if (fixture === undefined) throw new Error('fixture not set');
      const stdout = new StringStream();
      const stderr = new StringStream();
      const handler = createCleanupHandler();
      const exit = await handler(
        { verb: 'cleanup', positionals: [], flags: {} },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.SUCCESS);
      expect(stdout.text()).toContain('No active worktrees.');
      expect(stderr.text()).toBe('');
    });

    it('lists each journal entry with state + lock liveness', async () => {
      if (fixture === undefined) throw new Error('fixture not set');
      writeJournal(fixture.journalDir, 'T-001', 'claimed');
      writeJournal(fixture.journalDir, 'T-002', 'harvested');
      writeLock(fixture.locksDir, 'T-001', 99999); // mocked alive below
      // T-002 has no lock — represents a worktree that was harvested + lock released.

      const stdout = new StringStream();
      const stderr = new StringStream();
      const handler = createCleanupHandler({
        pidChecker: () => 'alive',
      });
      const exit = await handler(
        { verb: 'cleanup', positionals: [], flags: {} },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.SUCCESS);
      const out = stdout.text();
      expect(out).toContain('T-001');
      expect(out).toContain('state=claimed');
      expect(out).toContain('T-002');
      expect(out).toContain('state=harvested');
      expect(out).toContain('pid=99999');
      expect(out).toContain('alive');
      expect(stderr.text()).toBe('');
    });
  });

  describe('--force --task-id <id>', () => {
    it('removes the worktree dir + journal + lock', async () => {
      if (fixture === undefined) throw new Error('fixture not set');
      writeJournal(fixture.journalDir, 'T-200', 'dispatched');
      writeLock(fixture.locksDir, 'T-200', 12345);
      const worktreePath = path.join(fixture.parallelDir, 'wt-T-200');
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(path.join(worktreePath, 'sentinel.txt'), 'before');

      const gitCalls: Array<{ args: readonly string[]; cwd: string }> = [];
      const handler = createCleanupHandler({
        gitRunner: async (args, cwd) => {
          gitCalls.push({ args, cwd });
          rmSync(worktreePath, { recursive: true, force: true });
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      });
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = await handler(
        {
          verb: 'cleanup',
          positionals: [],
          flags: { force: true, 'task-id': 'T-200' },
        },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.SUCCESS);
      expect(gitCalls).toHaveLength(1);
      expect(gitCalls[0]?.args).toEqual(['worktree', 'remove', '--force', worktreePath]);
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(path.join(fixture.journalDir, 'wt-T-200.jsonl'))).toBe(false);
      expect(existsSync(path.join(fixture.locksDir, 'task-T-200.lock'))).toBe(false);
      expect(stdout.text()).toContain('Removed worktree, journal, and lock for T-200');
    });

    it('returns EXIT.USAGE_ERROR when --force is passed without --task-id', async () => {
      if (fixture === undefined) throw new Error('fixture not set');
      const stdout = new StringStream();
      const stderr = new StringStream();
      const handler = createCleanupHandler();
      const exit = await handler(
        { verb: 'cleanup', positionals: [], flags: { force: true } },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.USAGE_ERROR);
      expect(stderr.text()).toContain('--task-id');
    });

    it('cleans up journal + lock even when no worktree dir exists (partial state)', async () => {
      if (fixture === undefined) throw new Error('fixture not set');
      writeJournal(fixture.journalDir, 'T-300', 'created');
      writeLock(fixture.locksDir, 'T-300', 12345);
      // No parallel dir for T-300 — represents a crash before `git worktree add`.

      const handler = createCleanupHandler({
        gitRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      });
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = await handler(
        {
          verb: 'cleanup',
          positionals: [],
          flags: { force: true, 'task-id': 'T-300' },
        },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.SUCCESS);
      expect(existsSync(path.join(fixture.journalDir, 'wt-T-300.jsonl'))).toBe(false);
      expect(existsSync(path.join(fixture.locksDir, 'task-T-300.lock'))).toBe(false);
    });
  });

  describe('--prune-locks', () => {
    it('removes only dead-PID locks', async () => {
      if (fixture === undefined) throw new Error('fixture not set');
      writeLock(fixture.locksDir, 'T-LIVE', 11111);
      writeLock(fixture.locksDir, 'T-DEAD', 99999);

      const handler = createCleanupHandler({
        pidChecker: (pid) => (pid === 11111 ? 'alive' : 'dead'),
      });
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = await handler(
        { verb: 'cleanup', positionals: [], flags: { 'prune-locks': true } },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.SUCCESS);
      expect(existsSync(path.join(fixture.locksDir, 'task-T-LIVE.lock'))).toBe(true);
      expect(existsSync(path.join(fixture.locksDir, 'task-T-DEAD.lock'))).toBe(false);
      expect(stdout.text()).toContain('Purged 1 stale lock(s)');
    });

    it('reports "No stale locks found" when every PID is alive', async () => {
      if (fixture === undefined) throw new Error('fixture not set');
      writeLock(fixture.locksDir, 'T-A', 11111);

      const handler = createCleanupHandler({
        pidChecker: () => 'alive',
      });
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = await handler(
        { verb: 'cleanup', positionals: [], flags: { 'prune-locks': true } },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.SUCCESS);
      expect(stdout.text()).toContain('No stale locks found.');
    });
  });
});
