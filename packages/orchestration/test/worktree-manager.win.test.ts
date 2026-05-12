/**
 * Cross-OS path-discipline unit tests for `WorktreeManager` per ADR-009 +
 * Plan 03-04 PR-30.
 *
 * These tests run on every host (Linux/macOS/Windows) and don't require a
 * `process.platform === 'win32'` runner. The discipline they assert is
 * about what the manager WRITES (journal entries, gitRunner argv) — not
 * about how the OS interprets it. The properties:
 *
 *   1. Worktree paths recorded in journal entries are POSIX-form
 *      (forward-slash separated). Recovery code on any host reads the
 *      same string.
 *   2. The gitRunner receives forward-slash paths in argv (git on
 *      Windows accepts both; using POSIX form keeps assertions
 *      deterministic across runners).
 *   3. `WORKTREE_PATH_MAX_CHARS` (200) is enforced before git is
 *      invoked — `WorktreePathTooLongError` throws fast with a
 *      readable message.
 *   4. Journal lines end in `\n` (LF), not `\r\n` (CRLF), regardless
 *      of host. The cassette format + reproducible-build invariants
 *      depend on this.
 *
 * Win32-runner-only chaos (live git on Windows, MAX_PATH boundary
 * collisions) is operational concern, not a unit-test concern — that
 * activation is deferred to a user-driven Windows CI matrix.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  WORKTREE_PATH_MAX_CHARS,
  WorktreeManager,
  WorktreePathTooLongError,
  type GitRunResult,
  type GitRunner,
} from '../src/worktree-manager.js';

interface Fixture {
  readonly root: string;
  readonly parallelRoot: string;
  readonly journalRoot: string;
}

function setupFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-wt-win-'));
  const parallelRoot = path.posix.join(root.split(path.sep).join('/'), 'parallel');
  const journalRoot = path.posix.join(root.split(path.sep).join('/'), 'journal');
  mkdirSync(parallelRoot, { recursive: true });
  mkdirSync(journalRoot, { recursive: true });
  return { root, parallelRoot, journalRoot };
}

function makeRecordingGitRunner(): {
  runner: GitRunner;
  calls: Array<{ args: readonly string[]; cwd: string | undefined }>;
} {
  const calls: Array<{ args: readonly string[]; cwd: string | undefined }> = [];
  const runner: GitRunner = async (args, cwd): Promise<GitRunResult> => {
    calls.push({ args, cwd });
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
}

describe('WorktreeManager — Windows path discipline (ADR-009)', () => {
  it('journal entries record POSIX-style worktreePath (forward slash)', async () => {
    const fixture = setupFixture();
    try {
      const { runner } = makeRecordingGitRunner();
      const manager = new WorktreeManager({
        parallelRoot: fixture.parallelRoot,
        journalRoot: fixture.journalRoot,
        gitRunner: runner,
      });
      const { worktreePath } = await manager.create('T-WIN-01', 'main');

      // Internal handle is POSIX.
      expect(worktreePath).not.toMatch(/\\/);
      expect(worktreePath).toContain('/');

      // Journal records it the same way.
      const raw = readFileSync(path.join(fixture.journalRoot, 'wt-T-WIN-01.jsonl'), 'utf8');
      const entry = JSON.parse(raw.trim().split('\n')[0] ?? '{}') as {
        details?: { worktreePath?: string };
      };
      expect(entry.details?.worktreePath).toBe(worktreePath);
      expect(entry.details?.worktreePath).not.toMatch(/\\/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('gitRunner argv carries forward-slash worktreePath (cross-OS deterministic)', async () => {
    const fixture = setupFixture();
    try {
      const recording = makeRecordingGitRunner();
      const manager = new WorktreeManager({
        parallelRoot: fixture.parallelRoot,
        journalRoot: fixture.journalRoot,
        gitRunner: recording.runner,
      });
      await manager.create('T-WIN-02', 'main');
      expect(recording.calls).toHaveLength(1);
      const argv = recording.calls[0]?.args ?? [];
      expect(argv[0]).toBe('worktree');
      expect(argv[1]).toBe('add');
      expect(argv[2]).not.toMatch(/\\/); // POSIX form
      expect(argv[2]).toContain('/');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('throws WorktreePathTooLongError before invoking gitRunner when path > 200 chars', async () => {
    const fixture = setupFixture();
    try {
      const recording = makeRecordingGitRunner();
      // Build a parallelRoot that itself is past the cap.
      const longRoot = path.posix.join(fixture.parallelRoot, 'x'.repeat(220));
      const manager = new WorktreeManager({
        parallelRoot: longRoot,
        journalRoot: fixture.journalRoot,
        gitRunner: recording.runner,
      });
      await expect(manager.create('T-WIN-03', 'main')).rejects.toBeInstanceOf(
        WorktreePathTooLongError,
      );
      // gitRunner MUST NOT have been called — the cap fires first.
      expect(recording.calls).toHaveLength(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('WorktreePathTooLongError message includes the offending path + length + cap', async () => {
    const fixture = setupFixture();
    try {
      const longRoot = path.posix.join(fixture.parallelRoot, 'p'.repeat(220));
      const manager = new WorktreeManager({
        parallelRoot: longRoot,
        journalRoot: fixture.journalRoot,
        gitRunner: makeRecordingGitRunner().runner,
      });
      try {
        await manager.create('T-WIN-04', 'main');
        throw new Error('expected WorktreePathTooLongError');
      } catch (err) {
        expect(err).toBeInstanceOf(WorktreePathTooLongError);
        const msg = (err as Error).message;
        expect(msg).toContain(`${WORKTREE_PATH_MAX_CHARS}-char cap`);
        expect(msg).toMatch(/length=\d+/);
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('journal lines end with LF (\\n) regardless of host EOL', async () => {
    const fixture = setupFixture();
    try {
      const { runner } = makeRecordingGitRunner();
      const manager = new WorktreeManager({
        parallelRoot: fixture.parallelRoot,
        journalRoot: fixture.journalRoot,
        gitRunner: runner,
      });
      await manager.create('T-WIN-05', 'main');
      await manager.claim('T-WIN-05', ['src/foo.ts']);
      const raw = readFileSync(path.join(fixture.journalRoot, 'wt-T-WIN-05.jsonl'), 'utf8');
      // No CRLF anywhere.
      expect(raw).not.toMatch(/\r\n/);
      // Each non-empty entry ends in LF.
      const lines = raw.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      // Final element is empty (trailing newline) — the writer appends LF
      // after each entry.
      expect(raw.endsWith('\n')).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('right at the cap (=200 chars) succeeds; cap+1 fails', async () => {
    const fixture = setupFixture();
    try {
      const taskPrefix = 'wt-T-EDGE';
      // Build parallelRoot so that parallelRoot/wt-T-EDGE is exactly 200 chars.
      const targetLen = WORKTREE_PATH_MAX_CHARS;
      const tailLen = `/${taskPrefix}`.length;
      const padding = 'a'.repeat(targetLen - tailLen);
      const okRoot = padding;
      // okRoot is 'aaa...' (190 chars) -> okRoot + '/wt-T-EDGE' = 200 chars
      expect(path.posix.join(okRoot, taskPrefix).length).toBe(WORKTREE_PATH_MAX_CHARS);

      const recording = makeRecordingGitRunner();
      const okManager = new WorktreeManager({
        parallelRoot: okRoot,
        journalRoot: fixture.journalRoot,
        gitRunner: recording.runner,
      });
      // No throw at exactly the cap.
      await okManager.create('T-EDGE', 'main');
      expect(recording.calls).toHaveLength(1);

      // One char past the cap -> throws.
      const recording2 = makeRecordingGitRunner();
      const tooLongRoot = `${padding}b`; // 191 chars
      const overManager = new WorktreeManager({
        parallelRoot: tooLongRoot,
        journalRoot: fixture.journalRoot,
        gitRunner: recording2.runner,
      });
      await expect(overManager.create('T-EDGE', 'main')).rejects.toBeInstanceOf(
        WorktreePathTooLongError,
      );
      expect(recording2.calls).toHaveLength(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
