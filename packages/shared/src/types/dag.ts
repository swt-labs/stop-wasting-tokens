/**
 * DAG resolver types per TDD2 §9.3.
 *
 * The orchestration layer's `resolveDag` (M3 PR-24) converts a plan's
 * task array — each task declares `depends_on: string[]` — into ordered
 * parallel batches. Tasks within a batch can run in parallel (assuming
 * the dispatcher's claim-registry + worktree-manager carve out
 * isolation); successive batches run sequentially because they consume
 * earlier batches' outputs.
 *
 * Kept isomorphic with the methodology layer's plan-task representation
 * so the dispatcher doesn't need translation between layers.
 */

/**
 * Single task input to the resolver. Matches the relevant subset of
 * `TaskBrief` + plan-frontmatter task declarations — orchestration
 * doesn't care about the role / cwd / prompt content here, only the
 * dependency graph shape.
 */
export interface TaskNode {
  /** Unique task identifier (e.g. plan task IDs like `P01`, `T-001`). */
  readonly id: string;
  /**
   * Other task IDs this task depends on. Empty array (or omitted) =
   * task has no upstream dependencies and goes into the first batch.
   */
  readonly depends_on?: ReadonlyArray<string>;
}

/**
 * One batch of task IDs that can run in parallel. Order WITHIN a batch
 * is not meaningful (the dispatcher may dispatch them in any order or
 * concurrently); order BETWEEN batches is strict (batch N+1 depends
 * on outputs from batch N or earlier).
 */
export type TaskBatch = ReadonlyArray<string>;
