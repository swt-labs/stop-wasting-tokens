import { createSession, type SwtSession, type SwtSessionOptions } from '@swt-labs/runtime';

import type { Dispatcher, TaskBrief, TaskResult } from './types.js';

/**
 * Session factory contract — extracted so tests can inject a mock without
 * spinning up the real `createSession()` from `@swt-labs/runtime`.
 *
 * Matches `runtime`'s `createSession` signature exactly: pass `SwtSessionOptions`,
 * get a `Promise<SwtSession>`. PR-03 keeps the runtime impl as the default.
 */
export type SessionFactory = (opts: SwtSessionOptions) => Promise<SwtSession>;

/**
 * Sequential dispatcher.
 *
 * PR-03 is a stub: it creates a session, doesn't prompt, returns a synthetic
 * success `TaskResult`, and disposes the session. The wiring is real (session
 * lifecycle, error path via `try/finally`, dispatchBatch as serialised
 * `dispatch` calls); the contents are not (no Pi call, no methodology spec).
 *
 * Real dispatching lands in M2 PR-12 (Lead role through dispatcher) + PR-13
 * (Dev role through dispatcher). M3 PR-22..PR-29 adds worktree isolation,
 * claim registry, DAG-based parallel batches. The `Dispatcher` interface
 * stays stable across those changes — only `dispatch`'s body grows.
 */
export function createDispatcher(opts?: { sessionFactory?: SessionFactory }): Dispatcher {
  const factory: SessionFactory = opts?.sessionFactory ?? createSession;

  const dispatch = async (task: TaskBrief): Promise<TaskResult> => {
    const session = await factory({ cwd: task.cwd, ephemeral: true });
    try {
      // No prompt issued in PR-03. PR-12 (Plan 02) replaces this body with
      // a real `session.prompt(buildPrompt(...))` + harvest of swt_report_result.
      return {
        schema_version: 1,
        task_id: task.taskId,
        status: 'success',
        summary: '(M1 PR-03 stub dispatcher — real dispatch lands in M2 PR-12)',
        files_changed: [],
        must_haves: [],
      };
    } finally {
      session.dispose();
    }
  };

  return {
    dispatch,
    async dispatchBatch(tasks) {
      // Sequential by design at PR-03. Parallel batches land in M3 PR-22..24
      // (worktree-manager + claim-registry + dag-resolver). Same interface.
      const results: TaskResult[] = [];
      for (const t of tasks) results.push(await dispatch(t));
      return results;
    },
  };
}
