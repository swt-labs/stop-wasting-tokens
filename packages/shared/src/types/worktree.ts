/**
 * Worktree lifecycle types per TDD2 §9.1.
 *
 * The orchestration layer's `WorktreeManager` (M3 PR-22) emits journal
 * entries for every state transition; the dashboard's Worktrees panel
 * (Plan 03-02 PR-27) reads them; the chaos test suite (Plan 03-02
 * PR-28) injects SIGKILL between transitions and asserts recovery
 * lands the worktree at the same state on resume.
 *
 * `WorktreeState` is the FSM's state alphabet. Legal transitions are
 * enforced by `WorktreeManager.assertCanTransition` — illegal
 * transitions throw `IllegalTransitionError`. The terminal states are
 * `removed` (clean exit) and `failed` (preserved for forensics).
 *
 * `WorktreeJournalEntry` is the persisted record one per state
 * transition. The journal file is line-delimited JSON at
 * `<journalRoot>/wt-<taskId>.jsonl` so a `tail -F` reader (the
 * dashboard or `swt watch`) can stream transitions live.
 */

/**
 * Worktree lifecycle states. Order is meaningful — transitions only
 * move forward through this list (with the exception of `failed`,
 * which can be reached from any non-terminal state).
 */
export type WorktreeState =
  | 'created'
  | 'claimed'
  | 'dispatched'
  | 'agent_running'
  | 'agent_complete'
  | 'harvested'
  | 'removed'
  | 'failed';

/**
 * One persisted record per state transition. Written to
 * `<journalRoot>/wt-<taskId>.jsonl` (one JSON object per line).
 *
 * `from` is `'none'` for the initial `(none) → created` transition;
 * every other transition has a `WorktreeState` value.
 */
export interface WorktreeJournalEntry {
  /** ISO 8601 timestamp of when the transition was recorded. */
  readonly timestamp: string;
  /** Task ID this journal belongs to (matches `wt-<taskId>` filename). */
  readonly taskId: string;
  /** Previous state, or `'none'` for the initial `create` transition. */
  readonly from: WorktreeState | 'none';
  /** New state. */
  readonly to: WorktreeState;
  /**
   * Free-form details for the transition. Examples:
   *   - `create`: `{worktreePath, baseRef}`
   *   - `claim`: `{claims: string[]}`
   *   - `markAgentComplete`: `{outcome: 'success' | 'failed' | 'blocked'}`
   *   - `fail`: `{reason: string, keepWorktree?: boolean}`
   * Consumers (dashboard, chaos suite) should treat unknown keys as
   * informational and not load-bearing.
   */
  readonly details?: Readonly<Record<string, unknown>>;
}
