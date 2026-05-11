/**
 * Inline orchestration type definitions. PR-04 (`@swt-labs/shared`) extracts
 * the cross-package types into shared and orchestration re-exports from there.
 * Same plan-amendment as PR-02: keep types local until shared/ creation lands
 * to avoid a chicken-and-egg with PR-04 ordering.
 *
 * Once shared lands, this file becomes:
 *   export type { Dispatcher, TaskBrief, TaskResult, ... } from '@swt-labs/shared';
 */

import type { AgentRole } from '@swt-labs/core';

/**
 * Brief handed to the dispatcher when asking it to run one task.
 * PR-03 ships the structural shape only; PR-13 (Plan 02) extends with
 * `claims[]`, `depends_on[]`, and rich `promptContext`.
 */
export interface TaskBrief {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly cwd: string;
  /** Optional pre-built prompt; PR-03 ignores it (no real spawning). */
  readonly promptContext?: Readonly<Record<string, unknown>>;
  /** File-claim list — surfaces in M3 PR-23; empty in PR-03. */
  readonly claims?: ReadonlyArray<string>;
}

/**
 * Result envelope returned by `dispatcher.dispatch()`. Shape matches the
 * eventual `TaskResultSchema` Zod schema that lands in PR-04 — keeping it
 * here pre-shared simplifies PR-04's migration.
 */
export interface TaskResult {
  readonly schema_version: 1;
  readonly task_id: string;
  readonly status: 'success' | 'failed' | 'partial' | 'blocked';
  readonly summary: string;
  readonly files_changed: ReadonlyArray<{
    readonly path: string;
    readonly action: 'created' | 'modified' | 'deleted';
  }>;
  readonly must_haves: ReadonlyArray<{
    readonly id: string;
    readonly status: 'passed' | 'failed' | 'skipped';
    readonly evidence?: string;
  }>;
  readonly blockers?: ReadonlyArray<string>;
  readonly notes?: string;
}

/**
 * Minimal sequential dispatcher contract. M3 PR-22 introduces worktree-aware
 * parallel dispatching; this interface stays the same — the parallelism
 * lives inside `dispatchBatch`'s implementation, not in the surface API.
 */
export interface Dispatcher {
  dispatch(task: TaskBrief): Promise<TaskResult>;
  dispatchBatch(tasks: ReadonlyArray<TaskBrief>): Promise<ReadonlyArray<TaskResult>>;
}
