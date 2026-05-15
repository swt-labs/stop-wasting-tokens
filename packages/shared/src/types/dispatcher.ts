import type { AgentRole } from './agent-role.js';

/**
 * Brief handed to the dispatcher. Migrated from `orchestration/src/types.ts`
 * in PR-04. PR-13 (Plan 02) extends with `claims[]`, `depends_on[]`, and
 * rich `promptContext`.
 */
export interface TaskBrief {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly cwd: string;
  readonly promptContext?: Readonly<Record<string, unknown>>;
  readonly claims?: ReadonlyArray<string>;
}

/**
 * Result envelope returned by `dispatcher.dispatch()`. Matches the shape of
 * `TaskResultSchema` in `shared/src/schemas/task-result.ts` (Zod schema is
 * the runtime validator; this type is its TS surface for compile-time use).
 *
 * Phase 02 / Plan 02-01 — `usage?` added as an optional per-dispatch token
 * accumulation field. The dispatcher's production path (`session.prompt()`
 * wired) populates it by subscribing to `TASK_TOKEN_USAGE` events and
 * summing per-turn deltas. `cook.ts` reads this into the
 * `cook.agent_result` event payload, replacing the prior hardcoded
 * `{input_tokens: 0, output_tokens: 0}` sentinel. Cache fields are
 * provider-dependent (Anthropic surfaces them; OpenAI doesn't always) so
 * they remain optional even when the parent `usage` block is present.
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
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_tokens?: number;
    readonly cache_write_tokens?: number;
  };
}

/**
 * Minimal sequential dispatcher contract. M3 PR-22 introduces worktree-aware
 * parallel dispatching; the surface API stays the same.
 */
export interface Dispatcher {
  dispatch(task: TaskBrief): Promise<TaskResult>;
  dispatchBatch(tasks: ReadonlyArray<TaskBrief>): Promise<ReadonlyArray<TaskResult>>;
}
