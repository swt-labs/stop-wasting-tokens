/**
 * `WorktreeManager` — git-worktree lifecycle FSM per TDD2 §9.1.
 *
 * The manager owns the state transitions for parallel-task worktrees
 * created under `.swt-planning/parallel/wt-<taskId>/`. Each transition
 * emits a journal entry to `.swt-planning/journal/wt-<taskId>.jsonl`
 * (line-delimited JSON) so the dashboard's Worktrees panel + the
 * chaos test suite can stream + replay state changes.
 *
 * **M3 PR-22 ship state — standalone FSM, no Pi session wiring.** The
 * `dispatch` method records state but does NOT instantiate a
 * per-worktree Pi session — that wiring lands in a dedicated
 * follow-up PR ("session.prompt() activation") before Plan 03-02
 * begins. Until then, downstream callers handle session creation
 * themselves and notify the manager via `markAgentRunning` /
 * `markAgentComplete` to keep the journal accurate.
 *
 * **Lock-file integration is stubbed** at PR-22; PR-25 wires
 * `acquireLock` / `releaseLock` at the `created` and `removed` /
 * `failed` boundaries respectively. The TODO comments mark the
 * exact call sites.
 *
 * Path discipline: paths are POSIX-style in TypeScript; conversion to
 * Win32 happens at the `child_process.spawn` boundary per TDD2 §9.1.1.
 * Cross-OS testing is Plan 03-02 PR-30 territory.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, posix } from 'node:path';

import type { WorktreeJournalEntry, WorktreeState } from '@swt-labs/shared';

export const DEFAULT_PARALLEL_ROOT = '.swt-planning/parallel';
export const DEFAULT_JOURNAL_ROOT = '.swt-planning/journal';

export type AgentOutcome = 'success' | 'failed' | 'blocked';

export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Pluggable git command runner. Default impl spawns `git` via
 * `child_process.spawn`; tests inject a recording mock so worktree
 * lifecycle assertions don't require a real git tree on disk.
 */
export type GitRunner = (args: ReadonlyArray<string>, cwd?: string) => Promise<GitRunResult>;

export interface WorktreeManagerOptions {
  /** Parent directory for parallel worktrees. Default: `.swt-planning/parallel`. */
  readonly parallelRoot?: string;
  /** Directory for per-task journal files. Default: `.swt-planning/journal`. */
  readonly journalRoot?: string;
  /**
   * Pluggable git runner. Default: spawns `git` via `child_process.spawn`.
   * Tests inject a recording mock to assert FSM behaviour without a
   * real git tree on disk.
   */
  readonly gitRunner?: GitRunner;
  /**
   * Pluggable clock. Default: `() => new Date().toISOString()`. Tests
   * inject a deterministic clock so journal entry timestamps are
   * stable across runs.
   */
  readonly clock?: () => string;
  /**
   * Pluggable journal writer. Default: appends to the per-task
   * journal file via `fs/promises`. Tests inject an in-memory sink
   * to assert journal-write semantics without filesystem coupling.
   */
  readonly journalWriter?: (filePath: string, entry: WorktreeJournalEntry) => Promise<void>;
}

export class IllegalTransitionError extends Error {
  constructor(taskId: string, from: WorktreeState | 'none', to: WorktreeState) {
    super(
      `WorktreeManager: illegal transition for task ${taskId}: ${from} → ${to}. ` +
        `Legal transitions follow TDD2 §9.1's FSM.`,
    );
    this.name = 'IllegalTransitionError';
  }
}

export class WorktreeNotFoundError extends Error {
  constructor(taskId: string) {
    super(`WorktreeManager: no worktree state recorded for task ${taskId}.`);
    this.name = 'WorktreeNotFoundError';
  }
}

export class GitOperationError extends Error {
  constructor(operation: string, exitCode: number, stderr: string) {
    super(`git ${operation} failed (exit ${exitCode}): ${stderr.trim()}`);
    this.name = 'GitOperationError';
  }
}

/**
 * Worktree lifecycle FSM. One instance manages many tasks; state for
 * each task is keyed by taskId and journaled to its own file. Two
 * concurrent `WorktreeManager` instances against the same roots are
 * safe — journal writes are append-only and per-task.
 */
export class WorktreeManager {
  private readonly states = new Map<string, WorktreeState>();
  private readonly parallelRoot: string;
  private readonly journalRoot: string;
  private readonly gitRunner: GitRunner;
  private readonly clock: () => string;
  private readonly journalWriter: (filePath: string, entry: WorktreeJournalEntry) => Promise<void>;

  constructor(opts: WorktreeManagerOptions = {}) {
    this.parallelRoot = opts.parallelRoot ?? DEFAULT_PARALLEL_ROOT;
    this.journalRoot = opts.journalRoot ?? DEFAULT_JOURNAL_ROOT;
    this.gitRunner = opts.gitRunner ?? defaultGitRunner;
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.journalWriter = opts.journalWriter ?? defaultJournalWriter;
  }

  /**
   * Create a worktree for the given task at `<parallelRoot>/wt-<taskId>`
   * from the supplied base ref (typically the current milestone branch).
   *
   * Transitions `(none) → created`. On git failure, transitions
   * `(none) → failed` and throws `GitOperationError`.
   */
  async create(taskId: string, baseRef: string): Promise<{ worktreePath: string }> {
    this.assertCanTransition(taskId, 'created');
    const worktreePath = posix.join(this.parallelRoot, `wt-${taskId}`);
    // TODO(PR-25 lock-files): acquireLock(taskId, {worktreePath, pid: process.pid, ...})
    const result = await this.gitRunner(['worktree', 'add', worktreePath, baseRef]);
    if (result.exitCode !== 0) {
      // Force-transition straight to `failed` for the create-failure case.
      // The journal records the attempted from=`none` for traceability.
      this.states.set(taskId, 'failed');
      await this.writeJournal(taskId, 'none', 'failed', {
        operation: 'create',
        worktreePath,
        baseRef,
        reason: 'git_worktree_add_failed',
        stderr: result.stderr,
      });
      throw new GitOperationError('worktree add', result.exitCode, result.stderr);
    }
    this.states.set(taskId, 'created');
    await this.writeJournal(taskId, 'none', 'created', { worktreePath, baseRef });
    return { worktreePath };
  }

  /**
   * Record the file-claim array for the task. Claim-conflict
   * detection itself is the claim-registry's responsibility (PR-23);
   * this method just records the declared claims in the journal.
   *
   * Transitions `created → claimed`.
   */
  async claim(taskId: string, claims: ReadonlyArray<string>): Promise<void> {
    this.assertCanTransition(taskId, 'claimed');
    this.states.set(taskId, 'claimed');
    await this.writeJournal(taskId, 'created', 'claimed', { claims: [...claims] });
  }

  /**
   * Record that the task has been dispatched to an agent. Per-worktree
   * Pi session creation is the caller's responsibility today (deferred
   * follow-up PR will move it into this method).
   *
   * Transitions `claimed → dispatched`.
   */
  async dispatch(
    taskId: string,
    dispatchDetails?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    // TODO(session-wiring follow-up): instantiate per-worktree Pi
    // session here once `createSession` is wired to real Pi. Today the
    // caller handles session creation + drives the agent loop, then
    // notifies via `markAgentRunning` + `markAgentComplete`.
    this.assertCanTransition(taskId, 'dispatched');
    this.states.set(taskId, 'dispatched');
    await this.writeJournal(taskId, 'claimed', 'dispatched', dispatchDetails);
  }

  /**
   * Record that the agent has started its run loop. Called by the
   * dispatcher after `session.prompt()` is issued.
   *
   * Transitions `dispatched → agent_running`.
   */
  async markAgentRunning(taskId: string): Promise<void> {
    this.assertCanTransition(taskId, 'agent_running');
    this.states.set(taskId, 'agent_running');
    await this.writeJournal(taskId, 'dispatched', 'agent_running');
  }

  /**
   * Record that the agent loop has finished. Outcome is one of
   * `success | failed | blocked` (matches `TaskResult.status`).
   *
   * Transitions `agent_running → agent_complete`.
   */
  async markAgentComplete(taskId: string, outcome: AgentOutcome): Promise<void> {
    this.assertCanTransition(taskId, 'agent_complete');
    this.states.set(taskId, 'agent_complete');
    await this.writeJournal(taskId, 'agent_running', 'agent_complete', { outcome });
  }

  /**
   * Record that the orchestrator has read the `swt_report_result`
   * envelope and persisted the task result. Called immediately before
   * the worktree is removed.
   *
   * Transitions `agent_complete → harvested`.
   */
  async harvest(taskId: string): Promise<void> {
    this.assertCanTransition(taskId, 'harvested');
    this.states.set(taskId, 'harvested');
    await this.writeJournal(taskId, 'agent_complete', 'harvested');
  }

  /**
   * Remove the worktree. By default calls `git worktree remove
   * <path>`; pass `{keepForForensics: true}` to skip the git call but
   * still transition state (useful for the chaos suite + post-mortem
   * inspection paths per TDD2 §9.7).
   *
   * Transitions `harvested → removed`.
   */
  async remove(taskId: string, opts?: { readonly keepForForensics?: boolean }): Promise<void> {
    this.assertCanTransition(taskId, 'removed');
    const keep = opts?.keepForForensics === true;
    if (!keep) {
      const worktreePath = posix.join(this.parallelRoot, `wt-${taskId}`);
      const result = await this.gitRunner(['worktree', 'remove', worktreePath]);
      if (result.exitCode !== 0) {
        // git worktree remove failure → transition to failed, NOT removed.
        this.states.set(taskId, 'failed');
        await this.writeJournal(taskId, 'harvested', 'failed', {
          operation: 'remove',
          reason: 'git_worktree_remove_failed',
          stderr: result.stderr,
        });
        throw new GitOperationError('worktree remove', result.exitCode, result.stderr);
      }
    }
    // TODO(PR-25 lock-files): releaseLock(taskId)
    this.states.set(taskId, 'removed');
    await this.writeJournal(taskId, 'harvested', 'removed', {
      keepForForensics: keep,
    });
  }

  /**
   * Mark the task as failed. Reachable from any non-terminal state.
   * Never auto-removes the worktree per TDD2 §9.7 ("failed: Keep
   * (forensics)") — the operator decides whether to cleanup via `swt
   * cleanup` (Plan 03-02 PR-29).
   *
   * Transitions `<any non-terminal state> → failed`.
   */
  async fail(taskId: string, reason: string): Promise<void> {
    const from = this.getState(taskId) ?? 'none';
    if (from === 'removed' || from === 'failed') {
      throw new IllegalTransitionError(taskId, from, 'failed');
    }
    this.states.set(taskId, 'failed');
    await this.writeJournal(taskId, from, 'failed', { reason });
  }

  /**
   * Get the current state for a task, or `undefined` if no transition
   * has been recorded. Used by the dispatcher to make routing
   * decisions + by the chaos suite to assert resume targets.
   */
  getState(taskId: string): WorktreeState | undefined {
    return this.states.get(taskId);
  }

  private assertCanTransition(taskId: string, to: WorktreeState): void {
    const current = this.states.get(taskId);
    if (!isLegalTransition(current, to)) {
      throw new IllegalTransitionError(taskId, current ?? 'none', to);
    }
  }

  private async writeJournal(
    taskId: string,
    from: WorktreeState | 'none',
    to: WorktreeState,
    details?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const entry: WorktreeJournalEntry = {
      timestamp: this.clock(),
      taskId,
      from,
      to,
      ...(details !== undefined ? { details } : {}),
    };
    const filePath = posix.join(this.journalRoot, `wt-${taskId}.jsonl`);
    await this.journalWriter(filePath, entry);
  }
}

/**
 * Legal-transition lookup. The FSM moves forward through the state
 * list; `failed` can be reached from any non-terminal state.
 */
function isLegalTransition(from: WorktreeState | undefined, to: WorktreeState): boolean {
  // `failed` is reachable from any non-terminal state. The
  // terminal-state check is delegated to `fail()`'s explicit guard.
  if (to === 'failed') return from !== 'removed' && from !== 'failed';
  // Linear forward progression for all other transitions.
  const order: ReadonlyArray<WorktreeState | undefined> = [
    undefined, // (none) — initial state
    'created',
    'claimed',
    'dispatched',
    'agent_running',
    'agent_complete',
    'harvested',
    'removed',
  ];
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx === fromIdx + 1;
}

/**
 * Default journal writer — appends one line per call. Creates the
 * parent directory on first write per task. Tests inject an in-memory
 * sink to bypass filesystem coupling.
 */
async function defaultJournalWriter(filePath: string, entry: WorktreeJournalEntry): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * Default git runner — spawns `git` via `child_process.spawn` and
 * collects stdout/stderr/exitCode. Tests inject a recording mock to
 * assert command-line semantics without a real git tree.
 */
async function defaultGitRunner(args: ReadonlyArray<string>, cwd?: string): Promise<GitRunResult> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}
