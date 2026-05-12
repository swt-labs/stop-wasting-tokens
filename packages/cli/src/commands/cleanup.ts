/**
 * `swt cleanup` — operator-facing worktree retention + lock-file forensics
 * per TDD2 §9.7 + Plan 03-04 PR-29.
 *
 * Three modes (selected via flags):
 *
 *   - `swt cleanup` (default `--list`) — print every active worktree's
 *     task ID, last journal state, journal mtime, and lock-file PID +
 *     liveness. Read-only.
 *   - `swt cleanup --force --task-id <id>` — remove the worktree directory
 *     (`git worktree remove --force`), delete the journal file, and
 *     release the lock. Survives partial-state cleanup (a worktree that
 *     never reached `dispatched` still has a journal that should be
 *     removed).
 *   - `swt cleanup --prune-locks` — delegates to
 *     `purgeStaleLocks({purgeCorrupt: true})` from `@swt-labs/orchestration`.
 *     Drops every lock whose PID is dead OR whose envelope is corrupt.
 *     Prints the absolute paths of locks removed.
 *
 * Exit codes:
 *   0 — success (zero is success in every mode)
 *   1 — `EXIT.USAGE_ERROR` (e.g. `--force` without `--task-id`)
 *   2 — `EXIT.NOT_IMPLEMENTED` (no `.swt-planning/` in cwd)
 *   3 — `EXIT.RUNTIME_ERROR` (unexpected error from git/fs)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  LOCK_FILE_PREFIX,
  LOCK_FILE_SUFFIX,
  purgeStaleLocks,
  readLocks,
  type PidChecker,
  type ReadLockEntry,
} from '@swt-labs/orchestration';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

interface CleanupOptions {
  readonly mode: 'list' | 'force' | 'prune-locks';
  readonly taskId: string | undefined;
}

/**
 * Test seam — production callers run a real git binary; tests inject a
 * recording mock so worktree removal can be asserted without a real git
 * tree on disk.
 */
export interface CleanupDeps {
  readonly gitRunner?: (
    args: ReadonlyArray<string>,
    cwd: string,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /**
   * Override PID liveness probe. Defaults to `process.kill(pid, 0)` via
   * `defaultPidChecker` re-exported from `@swt-labs/orchestration`.
   */
  readonly pidChecker?: PidChecker;
}

export function createCleanupHandler(deps: CleanupDeps = {}): CommandHandler {
  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    const opts = resolveOptions(parsed.flags);
    if (opts === null) {
      io.stderr.write(
        'swt cleanup: --force requires --task-id <id>. Usage: swt cleanup [--list] | [--force --task-id <id>] | [--prune-locks]\n',
      );
      return EXIT.USAGE_ERROR;
    }

    const planningDir = join(io.cwd, '.swt-planning');
    if (!existsSync(planningDir)) {
      io.stderr.write('swt cleanup: no .swt-planning/ in this directory — run `swt init` first.\n');
      return EXIT.NOT_IMPLEMENTED;
    }

    try {
      switch (opts.mode) {
        case 'list':
          return await runList(io, planningDir, deps);
        case 'force':
          // taskId is guaranteed non-undefined by resolveOptions's `--force`
          // branch — when missing, that returns null and we exited above.
          return await runForce(io, planningDir, opts.taskId as string, deps);
        case 'prune-locks':
          return await runPruneLocks(io, planningDir, deps);
      }
    } catch (err) {
      io.stderr.write(
        `swt cleanup: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }
  };
}

/** Default handler with no injected deps. Production entry. */
export const cleanupHandler: CommandHandler = createCleanupHandler();

function resolveOptions(
  flags: Readonly<Record<string, string | boolean | undefined>>,
): CleanupOptions | null {
  const force = flags['force'] === true;
  const pruneLocks = flags['prune-locks'] === true;
  const taskId = typeof flags['task-id'] === 'string' ? flags['task-id'] : undefined;

  if (force && pruneLocks) return null;
  if (force) {
    if (taskId === undefined || taskId.length === 0) return null;
    return { mode: 'force', taskId };
  }
  if (pruneLocks) {
    return { mode: 'prune-locks', taskId: undefined };
  }
  return { mode: 'list', taskId: undefined };
}

async function runList(io: CommandIO, planningDir: string, deps: CleanupDeps): Promise<ExitCode> {
  const journalDir = join(planningDir, 'journal');
  const locksDir = join(planningDir, 'locks');

  const journalEntries = await readJournalSummaries(journalDir);
  const lockEntries = await safeReadLocks(locksDir, deps.pidChecker);
  const lockByTask = new Map<string, ReadLockEntry>();
  for (const lock of lockEntries) {
    lockByTask.set(lock.envelope.task_id, lock);
  }

  if (journalEntries.length === 0 && lockEntries.length === 0) {
    io.stdout.write('No active worktrees.\n');
    return EXIT.SUCCESS;
  }

  io.stdout.write('Active worktrees:\n');
  for (const entry of journalEntries) {
    const lock = lockByTask.get(entry.taskId);
    const lockNote =
      lock !== undefined ? `lock pid=${lock.envelope.pid} (${lock.liveness})` : 'no lock';
    io.stdout.write(
      `  ${entry.taskId.padEnd(20)} state=${entry.state.padEnd(16)} mtime=${entry.mtime}  ${lockNote}\n`,
    );
  }
  // Surface orphan locks (have lock but no journal — recovery-time signal).
  for (const lock of lockEntries) {
    if (journalEntries.some((j) => j.taskId === lock.envelope.task_id)) continue;
    io.stdout.write(
      `  ${lock.envelope.task_id.padEnd(20)} state=${'(no journal)'.padEnd(16)} mtime=—              lock pid=${lock.envelope.pid} (${lock.liveness})\n`,
    );
  }
  return EXIT.SUCCESS;
}

async function runForce(
  io: CommandIO,
  planningDir: string,
  taskId: string,
  deps: CleanupDeps,
): Promise<ExitCode> {
  const worktreePath = join(planningDir, 'parallel', `wt-${taskId}`);
  const journalPath = join(planningDir, 'journal', `wt-${taskId}.jsonl`);
  const lockPath = join(planningDir, 'locks', `${LOCK_FILE_PREFIX}${taskId}${LOCK_FILE_SUFFIX}`);

  // 1. git worktree remove --force. Only run when the worktree dir actually
  // exists — a worktree that never reached `dispatched` has a journal but
  // no parallel dir; we still want to remove the journal + lock.
  if (existsSync(worktreePath)) {
    const runner = deps.gitRunner ?? defaultGitRunner;
    const result = await runner(['worktree', 'remove', '--force', worktreePath], io.cwd);
    if (result.exitCode !== 0) {
      io.stderr.write(
        `swt cleanup: git worktree remove failed (exit ${result.exitCode}) — ${result.stderr.trim()}\n`,
      );
      // Fall through anyway — the journal + lock cleanup is still useful
      // for the operator and matches the "manual recovery" intent.
    }
  }

  await rm(journalPath, { force: true });
  await rm(lockPath, { force: true });
  io.stdout.write(`Removed worktree, journal, and lock for ${taskId}.\n`);
  return EXIT.SUCCESS;
}

async function runPruneLocks(
  io: CommandIO,
  planningDir: string,
  deps: CleanupDeps,
): Promise<ExitCode> {
  const locksRoot = join(planningDir, 'locks');
  const purged = await purgeStaleLocks({
    locksRoot,
    purgeCorrupt: true,
    ...(deps.pidChecker !== undefined ? { pidChecker: deps.pidChecker } : {}),
  });
  if (purged.length === 0) {
    io.stdout.write('No stale locks found.\n');
    return EXIT.SUCCESS;
  }
  io.stdout.write(`Purged ${purged.length} stale lock(s):\n`);
  for (const p of purged) io.stdout.write(`  ${p}\n`);
  return EXIT.SUCCESS;
}

interface JournalSummary {
  readonly taskId: string;
  readonly state: string;
  readonly mtime: string;
}

async function readJournalSummaries(journalDir: string): Promise<readonly JournalSummary[]> {
  let names: string[];
  try {
    names = await readdir(journalDir);
  } catch {
    return [];
  }
  const summaries: JournalSummary[] = [];
  for (const name of names) {
    if (!/^wt-.+\.jsonl$/.test(name)) continue;
    const filePath = join(journalDir, name);
    let raw: string;
    let mtime: string;
    try {
      raw = await readFile(filePath, 'utf8');
      const st = await stat(filePath);
      mtime = st.mtime.toISOString();
    } catch {
      continue;
    }
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    // Walk backwards to find the last valid entry.
    let taskId: string | null = null;
    let state: string | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === undefined) continue;
      try {
        const obj = JSON.parse(line) as { taskId?: unknown; to?: unknown };
        if (typeof obj.taskId === 'string' && typeof obj.to === 'string') {
          taskId = obj.taskId;
          state = obj.to;
          break;
        }
      } catch {
        continue;
      }
    }
    if (taskId === null || state === null) continue;
    summaries.push({ taskId, state, mtime });
  }
  // Sort by taskId for deterministic listing.
  return summaries.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

async function safeReadLocks(
  locksRoot: string,
  pidChecker: PidChecker | undefined,
): Promise<ReadonlyArray<ReadLockEntry>> {
  try {
    return await readLocks({
      locksRoot,
      ...(pidChecker !== undefined ? { pidChecker } : {}),
    });
  } catch {
    return [];
  }
}

async function defaultGitRunner(
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ exitCode: -1, stdout: '', stderr: err.message });
    });
  });
}
