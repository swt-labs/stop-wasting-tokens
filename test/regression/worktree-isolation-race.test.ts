import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WorktreeManager,
  acquireLock,
  createLockOpsFromAcquireLock,
} from '../../packages/orchestration/src/index.js';

/**
 * Plan 06-03 T3 — chaos regression test for the Phase 4 Wave 2 git-staging
 * race (research §2.2). Two parallel "teammates" each get their own worktree
 * via `WorktreeManager`, write a disjoint file, `git add` + commit. The
 * assertion is that each commit's diff touches ONLY that teammate's file —
 * no cross-staging. This is the structural property that makes the
 * Phase 4 Wave 2 symptom (commits 7431a02 / 05ebd94 with misleading
 * subjects) impossible.
 *
 * Negative case (`worktree_isolation: 'off'`) is documented in the
 * operator doc but NOT exercised here — the race is non-deterministic
 * in CI without explicit timing, and the prior real-world evidence
 * (commits 7431a02 / 05ebd94) is sufficient ground truth.
 */

let dir: string;

function gitInit(cwd: string): void {
  execSync('git init -q', { cwd });
  execSync('git config user.email test@swt.local', { cwd });
  execSync('git config user.name test', { cwd });
  execSync('git commit --allow-empty -m "initial" -q', { cwd });
}

function gitLogSubjects(cwd: string): readonly string[] {
  const out = execSync('git log --format=%s', { cwd, encoding: 'utf8' });
  return out.split('\n').filter((s) => s.length > 0);
}

function gitShowChangedFiles(cwd: string, ref: string): readonly string[] {
  const out = execSync(`git show --name-only --format= ${ref}`, {
    cwd,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-worktree-race-'));
  gitInit(dir);
});

afterEach(async () => {
  if (dir !== '') {
    try {
      // Best-effort: prune any worktrees git is still tracking before nuking
      // the parent dir so subsequent runs don't trip over stale worktree
      // metadata.
      execSync('git worktree prune', { cwd: dir });
    } catch {
      // ignore
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe('Plan 06-03 T3 — worktree isolation race regression', () => {
  it('two parallel teammates in separate worktrees produce disjoint commits', async () => {
    const locksRoot = join(dir, '.swt-planning', 'locks');
    const lockOps = createLockOpsFromAcquireLock((a) => acquireLock(a), locksRoot);
    const manager = new WorktreeManager({
      parallelRoot: join(dir, '.swt-planning', 'parallel'),
      journalRoot: join(dir, '.swt-planning', 'journal'),
      lockOps,
      gitRunner: async (args, runnerCwd) => {
        try {
          const result = execSync(`git ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
            cwd: runnerCwd ?? dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          return { exitCode: 0, stdout: result, stderr: '' };
        } catch (err: unknown) {
          const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
          return {
            exitCode: e.status ?? 1,
            stdout: e.stdout?.toString('utf8') ?? '',
            stderr: e.stderr?.toString('utf8') ?? '',
          };
        }
      },
    });

    // Drive both teammates in parallel: each acquires its own worktree,
    // writes its own file, stages + commits inside the worktree. The
    // WorktreeManager's create() shells out to `git worktree add` so each
    // teammate gets its own `.git/index`.
    async function runTeammate(taskId: string, fileName: string, subject: string): Promise<string> {
      const { worktreePath } = await manager.create(taskId, 'HEAD');
      // `worktreePath` matches whatever the manager passed to `git worktree
      // add` — here that's an absolute path because we configured the
      // manager with an absolute `parallelRoot`.
      const absWtPath = worktreePath;
      await writeFile(join(absWtPath, fileName), `content of ${fileName}\n`);
      execSync(`git add ${JSON.stringify(fileName)}`, { cwd: absWtPath });
      execSync(`git commit -m ${JSON.stringify(subject)} -q`, { cwd: absWtPath });
      const commitHash = execSync('git rev-parse HEAD', {
        cwd: absWtPath,
        encoding: 'utf8',
      }).trim();
      // Drive the FSM tail end so the lock + worktree get reaped cleanly.
      await manager.claim(taskId, [fileName]);
      await manager.dispatch(taskId);
      await manager.markAgentRunning(taskId);
      await manager.markAgentComplete(taskId, 'success');
      await manager.harvest(taskId);
      return commitHash;
    }

    const [hashA, hashB] = await Promise.all([
      runTeammate('taskA', 'pathA.txt', 'teammate A commit'),
      runTeammate('taskB', 'pathB.txt', 'teammate B commit'),
    ]);

    // Each commit touched ONLY its teammate's file — no cross-staging.
    const filesA = gitShowChangedFiles(dir, hashA);
    const filesB = gitShowChangedFiles(dir, hashB);
    expect(filesA).toEqual(['pathA.txt']);
    expect(filesB).toEqual(['pathB.txt']);

    // Commit subjects match the teammate that authored them — the
    // Phase 4 Wave 2 misleading-subject symptom is absent.
    const subjectA = execSync(`git show -s --format=%s ${hashA}`, {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    const subjectB = execSync(`git show -s --format=%s ${hashB}`, {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    expect(subjectA).toBe('teammate A commit');
    expect(subjectB).toBe('teammate B commit');

    // Now remove() each worktree. The FSM keeps each lock until remove()
    // succeeds — verify both clean up.
    await manager.remove('taskA');
    await manager.remove('taskB');
  });

  it.skip(
    'off-case race is non-deterministic in CI; manual reproduction only ' +
      '(prior real-world evidence: commits 7431a02 / 05ebd94 in main repo)',
    () => {
      // Intentionally skipped — the race is timing-sensitive against the
      // shared `.git/index`. The Phase 4 Wave 2 commits are the ground
      // truth that the symptom exists; the positive-case above is the
      // structural fix verification.
    },
  );

  it('orphan worktree from a failed run stays on disk for forensics', async () => {
    const locksRoot = join(dir, '.swt-planning', 'locks');
    const lockOps = createLockOpsFromAcquireLock((a) => acquireLock(a), locksRoot);
    const manager = new WorktreeManager({
      parallelRoot: join(dir, '.swt-planning', 'parallel'),
      journalRoot: join(dir, '.swt-planning', 'journal'),
      lockOps,
      gitRunner: async (args, runnerCwd) => {
        try {
          const result = execSync(`git ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
            cwd: runnerCwd ?? dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          return { exitCode: 0, stdout: result, stderr: '' };
        } catch (err: unknown) {
          const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
          return {
            exitCode: e.status ?? 1,
            stdout: e.stdout?.toString('utf8') ?? '',
            stderr: e.stderr?.toString('utf8') ?? '',
          };
        }
      },
    });

    const { worktreePath } = await manager.create('failed-task', 'HEAD');
    await manager.fail('failed-task', 'simulated_spawn_failure');

    // Worktree directory + lock are KEPT for operator review per TDD2 §9.7.
    // `worktreePath` is absolute because `parallelRoot` above is absolute.
    const fs = await import('node:fs');
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(join(locksRoot, 'task-failed-task.lock'))).toBe(true);

    // Subject log on the main repo is unchanged — the failed worktree had
    // no commits.
    expect(gitLogSubjects(dir)).toEqual(['initial']);
  });
});
