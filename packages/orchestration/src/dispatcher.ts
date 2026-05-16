import { createSession, type SwtSession, type SwtSessionOptions } from '@swt-labs/runtime';
import type { MeterContext, SwtEvent, TokenMeter } from '@swt-labs/shared';

import type { ClaimRegistry } from './claim-registry.js';
import {
  harvestTaskResult,
  harvestTaskResultFromEntries,
  type PiSessionEntryLike,
} from './result-harvest.js';
import type { Dispatcher, TaskBrief, TaskResult } from './types.js';

/**
 * Hard ceiling on the `summary` field of a failed TaskResult produced from
 * a `session.prompt()` throw. Defends the JSONL event channel from multi-KB
 * provider error payloads (e.g., stack-trace dumps) per Phase 02 / Plan
 * 02-01's Decisions block. 500 chars covers the relevant first line + a
 * short suffix without truncating mid-token in any expected format.
 */
const FAILED_SUMMARY_MAX_LEN = 500;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

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
  /**
   * Optional TokenMeter passed to the session factory so the runtime's
   * real Pi adapter routes `TASK_TOKEN_USAGE` records into the supplied
   * meter (PR-T meter-threading, M3 §13.3). When omitted, the dispatcher
   * still works — the session factory falls back to its own meter
   * handling (the mock factory ignores it; the real Pi adapter omits
   * meter records).
   */
  readonly meter?: TokenMeter;
  /**
   * Per-session meter dimensions threaded into `SwtSessionOptions.meterContext`.
   * The dispatcher itself doesn't know the milestone/phase context (those
   * come from the methodology layer above); accept them as opaque and
   * forward.
   */
  readonly meterContext?: MeterContext;
}

/**
 * Sequential dispatcher.
 *
 * PR-03 shipped a stub that created a session, didn't prompt, returned a
 * synthetic success, and disposed the session. PR-09 added the harvest
 * surface (`'entries' | 'file'`) so callers driving a real Pi session (or
 * replaying a recorded cassette) could validate the `swt-task-result`
 * custom entry per ADR-002. Phase 02 / Plan 02-01 closes the loop: the
 * default production path now calls `await session.prompt(...)`, subscribes
 * to `TASK_TOKEN_USAGE` events to accumulate per-turn token deltas, and
 * surfaces them on the returned `TaskResult.usage`. `'entries'` and
 * `'file'` strategies are unchanged — they remain test-injection seams.
 *
 * The session lifecycle (`try/finally session.dispose()`) is real today
 * and survives the harvest path — failures during harvest don't leak a
 * live session handle. A throw from `session.prompt()` is converted into
 * a structured `{status: 'failed'}` TaskResult so cook.ts's existing
 * failed-status pipeline fires (task_fail + completion-failed) instead of
 * the dispatcher re-throwing past the caller's outer code.
 */
export function createDispatcher(opts: CreateDispatcherOptions = {}): Dispatcher {
  const factory: SessionFactory = opts.sessionFactory ?? createSession;
  const strategy: HarvestStrategy = opts.harvestStrategy ?? 'stub';
  const claimRegistry = opts.claimRegistry;
  const meter = opts.meter;
  const meterContext = opts.meterContext;

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
      ...(meter !== undefined ? { meter } : {}),
      ...(meterContext !== undefined
        ? { meterContext: { ...meterContext, task_id: task.taskId } }
        : {}),
    });
    // Phase 02 / Plan 02-01 — production path: prompt + harvest
    // TASK_TOKEN_USAGE deltas. Test paths (`'entries'`, `'file'`) stay
    // declarative and run unchanged. The legacy no-prompt seam (no
    // `promptContext.prompt`) keeps returning synthetic success so the
    // existing `dispatcher.test.ts` shape needs no edits.
    let unsubscribeUsage: (() => void) | undefined;
    try {
      if (strategy === 'stub') {
        const promptText = extractPromptText(task);
        if (promptText === undefined) {
          // Legacy no-prompt test-seam path — NOT a production code path.
          // Existing `dispatcher.test.ts` cases dispatch TaskBriefs without
          // `promptContext`; preserving the synthetic success here keeps
          // those tests green without coupling them to the prompt+harvest
          // shape. Production callers (spawn-orchestrator-session,
          // spawn-agent) always populate `promptContext.prompt`.
          return {
            schema_version: 1,
            task_id: task.taskId,
            status: 'success',
            summary: '(dispatcher: legacy no-prompt test seam — promptContext.prompt absent)',
            files_changed: [],
            must_haves: [],
          };
        }
        const accumulated = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        // alpha.21 — capture the LAST TASK_ERROR observed during the turn.
        // Pi's upstream-API failures (out-of-credits, invalid-request,
        // rate-limit, network) flow through `turn_end` with `stopReason
        // === 'error'` rather than throwing from `agentSession.prompt()`,
        // so the dispatcher would silently report `status: 'success'`
        // with zero tokens otherwise (the symptom: cook.agent_result
        // status=completed, usage={input:0, output:0}, no UI surface for
        // the actual cause). The runtime's mapPiEvent now emits TASK_ERROR
        // for these events; the dispatcher converts it to TaskResult.
        // status='failed' below. We keep the LAST error rather than the
        // first because Pi may retry within the same prompt() invocation
        // — the terminal error is the one the user needs to act on.
        let lastError: string | undefined;
        unsubscribeUsage = session.subscribe((event: SwtEvent) => {
          if (event.type === 'TASK_TOKEN_USAGE') {
            accumulated.input += event.usage.input;
            accumulated.output += event.usage.output;
            accumulated.cacheRead += event.usage.cacheRead;
            accumulated.cacheWrite += event.usage.cacheWrite;
            return;
          }
          if (event.type === 'TASK_ERROR') {
            lastError = event.errorMessage;
          }
        });
        try {
          await session.prompt(promptText);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            schema_version: 1,
            task_id: task.taskId,
            status: 'failed',
            summary: truncate(
              `session.prompt() threw: ${message}` || 'session.prompt() threw',
              FAILED_SUMMARY_MAX_LEN,
            ),
            files_changed: [],
            must_haves: [],
          };
        }
        // alpha.21 — if any turn ended with stopReason='error', that's
        // a Pi-side LLM-call failure. Translate to TaskResult.status=
        // 'failed' so cook's surface path (alpha.20 Bug B fix in
        // routes/init.ts has the symmetric fix for init; cook.ts's
        // milestone-10 stderr-leak fix carries result.summary to the
        // dashboard already) renders the underlying cause.
        if (lastError !== undefined) {
          return {
            schema_version: 1,
            task_id: task.taskId,
            status: 'failed',
            summary: truncate(`Pi turn_end stopReason=error: ${lastError}`, FAILED_SUMMARY_MAX_LEN),
            files_changed: [],
            must_haves: [],
          };
        }
        return {
          schema_version: 1,
          task_id: task.taskId,
          status: 'success',
          summary: 'orchestrator session completed via dispatcher.prompt()',
          files_changed: [],
          must_haves: [],
          usage: {
            input_tokens: accumulated.input,
            output_tokens: accumulated.output,
            ...(accumulated.cacheRead > 0 ? { cache_read_tokens: accumulated.cacheRead } : {}),
            ...(accumulated.cacheWrite > 0 ? { cache_write_tokens: accumulated.cacheWrite } : {}),
          },
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
      if (unsubscribeUsage !== undefined) {
        try {
          unsubscribeUsage();
        } catch {
          // Defensive: a misbehaving session subscribe() implementation
          // must not stall session disposal. Swallow + continue.
        }
      }
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

/**
 * Pull the orchestrator's first-user-prompt text out of `TaskBrief.promptContext`.
 *
 * `promptContext` is typed as `Readonly<Record<string, unknown>>` (deliberately
 * opaque — the shared `TaskBrief` doesn't want to import callsite-specific
 * shapes), so we narrow defensively. Returns `undefined` when the brief
 * carries no usable prompt — the dispatcher then falls back to the legacy
 * no-prompt test-seam path.
 */
function extractPromptText(task: TaskBrief): string | undefined {
  const ctx = task.promptContext;
  if (ctx === undefined) return undefined;
  const candidate = (ctx as { prompt?: unknown }).prompt;
  if (typeof candidate !== 'string') return undefined;
  return candidate.length > 0 ? candidate : undefined;
}

function assertTaskIdMatch(harvestedId: string, dispatchedId: string): void {
  if (harvestedId !== dispatchedId) {
    throw new Error(
      `dispatcher harvest mismatch: dispatched task_id=${dispatchedId} but harvested swt-task-result carried task_id=${harvestedId}. This usually indicates a stale entry leaked across dispatches (the dispatcher creates ephemeral sessions so this should not happen in normal flow).`,
    );
  }
}
