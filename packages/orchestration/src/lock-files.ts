/**
 * Per-task lock files per TDD2 §9.5.
 *
 * Each dispatched task acquires a lock at
 * `.swt-planning/locks/task-<taskId>.lock`. The lock-file envelope
 * (validated via `LockFileEnvelopeSchema` from `@swt-labs/shared`)
 * carries PID + worktree path + session ID + last-known state. PID
 * liveness via `process.kill(pid, 0)` is the deterministic signal
 * for crash recovery — no heuristics.
 *
 * **M3 PR-25 ship state.** Standalone module + wiring into
 * `WorktreeManager` via the optional `lockOps` injection point.
 * The chaos test suite (Plan 03-02 PR-28) consumes `readLocks` +
 * `purgeStaleLocks` to verify SIGKILL-resume guarantees.
 *
 * Path discipline: lock-file paths are POSIX-style. The IO layer
 * (Node's `fs/promises`) handles the OS-level path conversion when
 * needed. Cross-OS testing lives at Plan 03-02 PR-30.
 */

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';

import { LockFileEnvelopeSchema, type LockFileEnvelope } from '@swt-labs/shared';

export const DEFAULT_LOCKS_ROOT = '.swt-planning/locks';
export const LOCK_FILE_PREFIX = 'task-';
export const LOCK_FILE_SUFFIX = '.lock';

export type PidLiveness = 'alive' | 'dead' | 'unknown';

export type PidChecker = (pid: number) => PidLiveness;

export interface AcquireLockOptions {
  /** Task ID — becomes the basename `task-<taskId>.lock`. */
  readonly taskId: string;
  /** Worktree path the lock guards. */
  readonly worktreePath: string;
  /** Initial worktree state — written verbatim into the envelope. */
  readonly state: LockFileEnvelope['state'];
  /** Optional Pi session ID (set once dispatched). */
  readonly sessionId?: string;
  /** Override the PID written into the envelope (defaults to `process.pid`). */
  readonly pid?: number;
  /** Override the locks-root directory (default: `.swt-planning/locks`). */
  readonly locksRoot?: string;
  /** Override the clock for deterministic tests. Default: ISO-from-`Date.now()`. */
  readonly clock?: () => string;
  /**
   * Override the PID liveness probe for tests. Default: `process.kill(pid, 0)`
   * mapped to `'alive' | 'dead'`.
   */
  readonly pidChecker?: PidChecker;
}

export interface LockHandle {
  /** Absolute path to the lock file on disk. */
  readonly path: string;
  /** Task ID this handle owns. */
  readonly taskId: string;
  /** Delete the lock file from disk. Idempotent. */
  release(): Promise<void>;
  /**
   * Patch a subset of mutable envelope fields (state, session_id,
   * worktree_path). The patch is merged with the existing envelope +
   * re-validated + re-written. `started_at` + `pid` + `task_id` +
   * `schema_version` are immutable.
   */
  update(
    patch: Partial<Pick<LockFileEnvelope, 'state' | 'session_id' | 'worktree_path'>>,
  ): Promise<void>;
}

export class LockAcquireConflictError extends Error {
  readonly kind = 'conflict' as const;
  readonly taskId: string;
  readonly holderPid: number;

  constructor(taskId: string, holderPid: number) {
    super(
      `acquireLock: task ${taskId} is already locked by live PID ${holderPid}. ` +
        `Use \`purgeStaleLocks\` to drop dead-PID locks before retrying.`,
    );
    this.name = 'LockAcquireConflictError';
    this.taskId = taskId;
    this.holderPid = holderPid;
  }
}

export class LockFileParseError extends Error {
  readonly kind = 'parse' as const;
  constructor(filePath: string, cause: unknown) {
    super(
      `Lock file at ${filePath} failed to parse against LockFileEnvelopeSchema: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'LockFileParseError';
  }
}

/**
 * Default PID liveness probe — uses `process.kill(pid, 0)`. Maps:
 *   - no throw         → alive
 *   - `ESRCH`          → dead (no such process)
 *   - `EPERM`          → alive (exists, can't signal — still a real process)
 *   - other error      → unknown (be conservative — don't purge)
 */
export const defaultPidChecker: PidChecker = (pid: number): PidLiveness => {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'alive';
    return 'unknown';
  }
};

/**
 * Acquire a lock for the given task. Writes the envelope to
 * `<locksRoot>/task-<taskId>.lock`. If a lock file already exists
 * and the holder PID is alive (different from `opts.pid`), throws
 * `LockAcquireConflictError`. If the holder is dead OR the holder is
 * the same PID (re-acquire), the lock is overwritten with the new
 * envelope.
 */
export async function acquireLock(opts: AcquireLockOptions): Promise<LockHandle> {
  const locksRoot = opts.locksRoot ?? DEFAULT_LOCKS_ROOT;
  const taskId = opts.taskId;
  const pid = opts.pid ?? process.pid;
  const clock = opts.clock ?? (() => new Date().toISOString());
  const pidChecker = opts.pidChecker ?? defaultPidChecker;
  const filePath = lockPathFor(locksRoot, taskId);

  // Conflict probe: read existing envelope (if any), check liveness.
  try {
    const raw = await readFile(filePath, 'utf8');
    const existing = parseEnvelopeOrThrow(filePath, raw);
    if (existing.pid !== pid) {
      const liveness = pidChecker(existing.pid);
      if (liveness === 'alive' || liveness === 'unknown') {
        // Be conservative on 'unknown' — refuse rather than risk
        // double-dispatch into a worktree that may still be in use.
        throw new LockAcquireConflictError(taskId, existing.pid);
      }
    }
    // Same PID or dead holder → fall through and overwrite.
  } catch (err) {
    if (err instanceof LockAcquireConflictError || err instanceof LockFileParseError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    // ENOENT: no existing lock — clean acquire path.
  }

  const envelope: LockFileEnvelope = {
    schema_version: 1,
    task_id: taskId,
    pid,
    started_at: clock(),
    worktree_path: opts.worktreePath,
    state: opts.state,
    ...(opts.sessionId !== undefined ? { session_id: opts.sessionId } : {}),
  };
  LockFileEnvelopeSchema.parse(envelope);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(envelope, null, 2), 'utf8');

  return buildHandle({ filePath, taskId, clock });
}

export interface ReadLockEntry {
  /** Absolute path to the lock file. */
  readonly path: string;
  /** Parsed envelope (validated against `LockFileEnvelopeSchema`). */
  readonly envelope: LockFileEnvelope;
  /** PID liveness flag at the time `readLocks` ran. */
  readonly liveness: PidLiveness;
}

export interface ReadLocksOptions {
  readonly locksRoot?: string;
  readonly pidChecker?: PidChecker;
}

/**
 * Scan `<locksRoot>/` and return all parseable lock-file entries with
 * their PID liveness. Files that don't parse against the schema are
 * silently skipped (corrupt locks are a recovery-time concern, not a
 * read-time one — `purgeStaleLocks` can drop them).
 */
export async function readLocks(
  opts: ReadLocksOptions = {},
): Promise<ReadonlyArray<ReadLockEntry>> {
  const locksRoot = opts.locksRoot ?? DEFAULT_LOCKS_ROOT;
  const pidChecker = opts.pidChecker ?? defaultPidChecker;
  let names: string[];
  try {
    names = await readdir(locksRoot);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  const entries: ReadLockEntry[] = [];
  for (const name of names) {
    if (!name.startsWith(LOCK_FILE_PREFIX) || !name.endsWith(LOCK_FILE_SUFFIX)) continue;
    const filePath = posix.join(locksRoot, name);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    let envelope: LockFileEnvelope;
    try {
      envelope = parseEnvelopeOrThrow(filePath, raw);
    } catch {
      // Skip un-parseable locks; purgeStaleLocks's `purgeCorrupt`
      // option handles cleanup.
      continue;
    }
    entries.push({ path: filePath, envelope, liveness: pidChecker(envelope.pid) });
  }
  return entries;
}

export interface PurgeStaleLocksOptions {
  readonly locksRoot?: string;
  readonly pidChecker?: PidChecker;
  /**
   * Also drop lock files that don't parse against the schema.
   * Default: `false` (preserve corrupt files for forensics).
   */
  readonly purgeCorrupt?: boolean;
}

/**
 * Delete lock files whose holder PID is dead. Returns the absolute
 * paths of locks that were dropped.
 *
 * Note: this is the "PID-only" purge per TDD2 §9.5.6's deterministic
 * recovery rule. The full §9.5 recovery rule also requires the worktree
 * journal to show an incomplete transition — that integration lands
 * alongside PR-26 + chaos-test wiring (Plan 03-02 PR-28). For PR-25
 * the PID-only signal is the foundation; downstream callers can layer
 * the journal check on top.
 */
export async function purgeStaleLocks(
  opts: PurgeStaleLocksOptions = {},
): Promise<ReadonlyArray<string>> {
  const locksRoot = opts.locksRoot ?? DEFAULT_LOCKS_ROOT;
  const pidChecker = opts.pidChecker ?? defaultPidChecker;
  const purgeCorrupt = opts.purgeCorrupt === true;
  let names: string[];
  try {
    names = await readdir(locksRoot);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  const purged: string[] = [];
  for (const name of names) {
    if (!name.startsWith(LOCK_FILE_PREFIX) || !name.endsWith(LOCK_FILE_SUFFIX)) continue;
    const filePath = posix.join(locksRoot, name);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    let envelope: LockFileEnvelope | undefined;
    try {
      envelope = parseEnvelopeOrThrow(filePath, raw);
    } catch {
      if (purgeCorrupt) {
        await unlink(filePath).catch(() => undefined);
        purged.push(filePath);
      }
      continue;
    }
    if (pidChecker(envelope.pid) === 'dead') {
      await unlink(filePath).catch(() => undefined);
      purged.push(filePath);
    }
  }
  return purged;
}

/** Resolve the canonical lock-file path for a task. */
export function lockPathFor(locksRoot: string, taskId: string): string {
  return posix.join(locksRoot, `${LOCK_FILE_PREFIX}${taskId}${LOCK_FILE_SUFFIX}`);
}

function buildHandle(args: {
  readonly filePath: string;
  readonly taskId: string;
  readonly clock: () => string;
}): LockHandle {
  return {
    path: args.filePath,
    taskId: args.taskId,
    async release(): Promise<void> {
      try {
        await unlink(args.filePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        throw err;
      }
    },
    async update(patch): Promise<void> {
      const raw = await readFile(args.filePath, 'utf8');
      const existing = parseEnvelopeOrThrow(args.filePath, raw);
      const next: LockFileEnvelope = {
        ...existing,
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.session_id !== undefined ? { session_id: patch.session_id } : {}),
        ...(patch.worktree_path !== undefined ? { worktree_path: patch.worktree_path } : {}),
        updated_at: args.clock(),
      };
      LockFileEnvelopeSchema.parse(next);
      await writeFile(args.filePath, JSON.stringify(next, null, 2), 'utf8');
    },
  };
}

function parseEnvelopeOrThrow(filePath: string, raw: string): LockFileEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LockFileParseError(filePath, err);
  }
  try {
    return LockFileEnvelopeSchema.parse(parsed);
  } catch (err) {
    throw new LockFileParseError(filePath, err);
  }
}
