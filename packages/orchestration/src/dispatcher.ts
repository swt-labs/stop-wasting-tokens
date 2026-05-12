import { createSession, type SwtSession, type SwtSessionOptions } from '@swt-labs/runtime';

import type { ClaimRegistry } from './claim-registry.js';
import {
  harvestTaskResult,
  harvestTaskResultFromEntries,
  type PiSessionEntryLike,
} from './result-harvest.js';
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
 * Result-harvest strategy passed at dispatcher-construction time.
 *
 * - `'stub'` (default) — dispatcher returns a synthetic success result
 *   without inspecting any session state. This is the PR-03 behaviour and
 *   it's what consumers without a real Pi session (or without a recorded
 *   cassette) should keep using.
 * - `{ kind: 'entries', getEntries: (task) => entries }` — dispatcher reads
 *   the session's in-memory entry list (Pi's `sessionManager.getEntries()`
 *   shape) and validates against `TaskResultSchema`. This is the path
 *   used by the integration test in PR-09 once the cassette lands.
 * - `{ kind: 'file', resolvePath: (task) => path }` — dispatcher reads the
 *   per-session JSONL session file from disk. Used by M3+ when the
 *   orchestrator drives Pi out-of-process.
 *
 * The strategy is purely declarative — the dispatcher invokes it after
 * `session.prompt()` returns. Errors from `harvestTaskResult*` bubble up
 * unchanged so the caller sees the precise validation failure.
 */
export type HarvestStrategy =
  | 'stub'
  | {
      readonly kind: 'entries';
      readonly getEntries: (task: TaskBrief) => ReadonlyArray<PiSessionEntryLike>;
    }
  | { readonly kind: 'file'; readonly resolvePath: (task: TaskBrief) => string };

export interface CreateDispatcherOptions {
  readonly sessionFactory?: SessionFactory;
  /**
   * How the dispatcher converts a finished session into a `TaskResult`.
   * Defaults to `'stub'` — synthetic success, no session inspection.
   */
  readonly harvestStrategy?: HarvestStrategy;
  /**
   * Optional file-claim registry per TDD2 §9.2. When provided, the
   * dispatcher registers `task.claims` with the registry before
   * creating a session; a conflict short-circuits with a
   * `{status: 'blocked', blockers: ['claim-conflict-with-<otherTaskId>']}`
   * `TaskResult` and never touches the session factory. Claims are
   * released in the `finally` block alongside `session.dispose()`.
   *
   * Sequential dispatch (PR-09 default) doesn't really exercise this —
   * each task acquires + releases back-to-back. Wire-up is here so the
   * parallel dispatch path (PR-24 + future) inherits conflict
   * checking automatically.
   */
  readonly claimRegistry?: ClaimRegistry;
}

/**
 * Sequential dispatcher.
 *
 * PR-03 shipped a stub: it created a session, didn't prompt, returned a
 * synthetic success, and disposed the session. PR-09 (this PR) adds the
 * harvest surface: callers who wire a real Pi session (or replay a
 * recorded cassette) can switch `harvestStrategy` from `'stub'` to
 * `{ kind: 'entries' | 'file', ... }` so the dispatcher reads + validates
 * the `swt-task-result` custom session entry per ADR-002. Real prompting
 * + agent loop wiring lands in M2 PR-12 + PR-13.
 *
 * The session lifecycle (`try/finally session.dispose()`) is real today
 * and survives the harvest path — failures during harvest don't leak a
 * live session handle.
 */
export function createDispatcher(opts: CreateDispatcherOptions = {}): Dispatcher {
  const factory: SessionFactory = opts.sessionFactory ?? createSession;
  const strategy: HarvestStrategy = opts.harvestStrategy ?? 'stub';
  const claimRegistry = opts.claimRegistry;

  const dispatch = async (task: TaskBrief): Promise<TaskResult> => {
    // Claim check (PR-23). When a registry is wired AND the task
    // declared claims, register them before creating the session.
    // Conflict → short-circuit with a blocked TaskResult; no session,
    // no LLM spend.
    if (claimRegistry !== undefined && task.claims !== undefined && task.claims.length > 0) {
      const result = claimRegistry.register(task.taskId, task.claims);
      if (!result.ok) {
        const blockers = result.conflicts.map(
          (c) => `claim-conflict-with-${c.otherTaskId}:${c.path}`,
        );
        return {
          schema_version: 1,
          task_id: task.taskId,
          status: 'blocked',
          summary: `claim-registry blocked dispatch — ${result.conflicts.length} conflict(s)`,
          files_changed: [],
          must_haves: [],
          blockers,
        };
      }
    }
    // PR-26 wire-up: every dispatched session carries the
    // `swt_report_result` extension hook + the task ID so the runtime
    // can register the Pi Extension + write the `task-context` session
    // entry before `prompt()` fires. The mock createSession records
    // both as no-ops today; the real Pi adapter (deferred session-wiring
    // follow-up) consumes them per ADR-002.
    const session = await factory({
      cwd: task.cwd,
      ephemeral: true,
      enableResultProtocol: true,
      taskId: task.taskId,
    });
    try {
      // PR-09: session.prompt() is still a no-op (createSession ships a
      // mock until M2 swaps in real Pi wiring). The harvest path runs
      // anyway when the strategy is non-stub — that path is exercised by
      // the integration test in PR-09 via injected mock entries.
      if (strategy === 'stub') {
        return {
          schema_version: 1,
          task_id: task.taskId,
          status: 'success',
          summary: '(M1 PR-09 stub dispatcher — real prompt wiring lands in M2 PR-12)',
          files_changed: [],
          must_haves: [],
        };
      }
      if (strategy.kind === 'entries') {
        const entries = strategy.getEntries(task);
        const result = harvestTaskResultFromEntries(entries, `task ${task.taskId}`);
        assertTaskIdMatch(result.task_id, task.taskId);
        return result;
      }
      // strategy.kind === 'file'
      const path = strategy.resolvePath(task);
      const result = harvestTaskResult(path);
      assertTaskIdMatch(result.task_id, task.taskId);
      return result;
    } finally {
      session.dispose();
      // Release claims AFTER the session disposes so the slot stays
      // locked through any harvest-side cleanup. Idempotent — safe
      // when no claims were registered (the `if` guard above
      // short-circuited).
      if (claimRegistry !== undefined && task.claims !== undefined && task.claims.length > 0) {
        claimRegistry.release(task.taskId);
      }
    }
  };

  return {
    dispatch,
    async dispatchBatch(tasks) {
      // Sequential by design at PR-09. Parallel batches land in M3 PR-22..24
      // (worktree-manager + claim-registry + dag-resolver). Same interface.
      const results: TaskResult[] = [];
      for (const t of tasks) results.push(await dispatch(t));
      return results;
    },
  };
}

function assertTaskIdMatch(harvestedId: string, dispatchedId: string): void {
  if (harvestedId !== dispatchedId) {
    throw new Error(
      `dispatcher harvest mismatch: dispatched task_id=${dispatchedId} but harvested swt-task-result carried task_id=${harvestedId}. This usually indicates a stale entry leaked across dispatches (the dispatcher creates ephemeral sessions so this should not happen in normal flow).`,
    );
  }
}
