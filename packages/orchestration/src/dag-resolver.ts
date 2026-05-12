/**
 * `resolveDag` — converts a plan's task array (with `depends_on[]`
 * declarations) into ordered parallel batches per TDD2 §9.3.
 *
 * Algorithm: Kahn's topological sort, batched.
 *   1. Build the adjacency map (dep → dependents) + in-degree count.
 *   2. Validate: every `depends_on` reference must point at a known
 *      task. Missing → `MissingDependencyError`.
 *   3. Detect duplicate task IDs upfront — same ID twice is a plan
 *      defect, not a tolerable input.
 *   4. Repeat: collect all tasks with in-degree 0 into a batch;
 *      remove them; decrement dependents. Loop until empty.
 *   5. If any task remains after the loop, a cycle exists →
 *      `CycleDetectedError` with the residual node IDs (which are the
 *      nodes participating in the cycle).
 *
 * Order WITHIN a batch is the order tasks first appeared in the input
 * array (Kahn doesn't otherwise define within-batch order; this gives
 * deterministic output for tests + reproducible logs).
 *
 * The dispatcher (M3 PR-25+ wiring) consumes batches sequentially:
 * within a batch it spawns up to `config.max_parallel_tasks` worktrees
 * concurrently (bounded by claim-registry + provider rate-limits).
 */

import type { TaskBatch, TaskNode } from '@swt-labs/shared';

export type ResolveDagResult =
  | { readonly ok: true; readonly batches: ReadonlyArray<TaskBatch> }
  | { readonly ok: false; readonly error: DagError };

export type DagError = CycleDetectedError | MissingDependencyError | DuplicateTaskError;

export class CycleDetectedError extends Error {
  readonly kind = 'cycle' as const;
  /**
   * Task IDs involved in the unresolved cycle. These are the residual
   * nodes after Kahn's algorithm has consumed all reachable
   * in-degree-0 tasks. May include nodes that depend on the cycle but
   * are not part of it themselves — the caller should treat this as
   * a "tasks that could not be scheduled" set.
   */
  readonly residualNodes: ReadonlyArray<string>;

  constructor(residualNodes: ReadonlyArray<string>) {
    const sorted = [...residualNodes].sort();
    super(
      `resolveDag: cycle detected — ${sorted.length} task(s) could not be scheduled: ` +
        `[${sorted.join(', ')}]. Inspect their depends_on arrays for a circular reference.`,
    );
    this.name = 'CycleDetectedError';
    this.residualNodes = sorted;
  }
}

export class MissingDependencyError extends Error {
  readonly kind = 'missing-dep' as const;
  readonly taskId: string;
  readonly missingDependency: string;

  constructor(taskId: string, missingDependency: string) {
    super(
      `resolveDag: task ${taskId} declares depends_on=${missingDependency} ` +
        `but no task with that ID exists in the input.`,
    );
    this.name = 'MissingDependencyError';
    this.taskId = taskId;
    this.missingDependency = missingDependency;
  }
}

export class DuplicateTaskError extends Error {
  readonly kind = 'duplicate' as const;
  readonly taskId: string;

  constructor(taskId: string) {
    super(
      `resolveDag: task ID ${taskId} appears more than once in the input. ` +
        `Task IDs must be unique within a plan.`,
    );
    this.name = 'DuplicateTaskError';
    this.taskId = taskId;
  }
}

/**
 * Resolve an array of TaskNodes into ordered parallel batches. Returns
 * a discriminated `ResolveDagResult` — callers should check `ok`
 * before dereferencing `batches` or `error`.
 *
 * Empty input returns `{ok: true, batches: []}` — the caller is
 * responsible for treating no-batches as no-op vs warning.
 */
export function resolveDag(tasks: ReadonlyArray<TaskNode>): ResolveDagResult {
  // Empty input is valid — no work to dispatch.
  if (tasks.length === 0) {
    return { ok: true, batches: [] };
  }

  // 1. Build in-degree + reverse adjacency (depends_on → dependents).
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep ID → tasks that depend on it
  const idsInOrder: string[] = [];
  for (const task of tasks) {
    if (inDegree.has(task.id)) {
      return { ok: false, error: new DuplicateTaskError(task.id) };
    }
    inDegree.set(task.id, task.depends_on?.length ?? 0);
    idsInOrder.push(task.id);
    dependents.set(task.id, []);
  }

  // 2. Validate every depends_on points at a known task + build
  //    reverse adjacency.
  for (const task of tasks) {
    if (task.depends_on === undefined) continue;
    for (const dep of task.depends_on) {
      const depDependents = dependents.get(dep);
      if (depDependents === undefined) {
        return { ok: false, error: new MissingDependencyError(task.id, dep) };
      }
      depDependents.push(task.id);
    }
  }

  // 3. Kahn batched topological sort.
  const batches: string[][] = [];
  let scheduled = 0;
  while (scheduled < tasks.length) {
    // Collect every task with in-degree 0, in input order.
    const batch: string[] = [];
    for (const id of idsInOrder) {
      if (inDegree.get(id) === 0) batch.push(id);
    }
    if (batch.length === 0) {
      // No tasks with in-degree 0 left but tasks remain → cycle.
      const residual: string[] = [];
      for (const id of idsInOrder) {
        const remaining = inDegree.get(id);
        if (remaining !== undefined && remaining > 0) residual.push(id);
      }
      return { ok: false, error: new CycleDetectedError(residual) };
    }
    batches.push(batch);
    // "Remove" each scheduled task: mark its in-degree as -1 (sentinel
    // so the next iteration doesn't re-pick it) and decrement the
    // in-degree of each dependent.
    for (const id of batch) {
      inDegree.set(id, -1);
      const ds = dependents.get(id);
      if (ds === undefined) continue;
      for (const d of ds) {
        const cur = inDegree.get(d);
        if (cur !== undefined && cur > 0) inDegree.set(d, cur - 1);
      }
    }
    scheduled += batch.length;
  }

  return { ok: true, batches };
}
