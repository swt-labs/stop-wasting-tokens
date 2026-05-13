/**
 * Provider fallback chain + retry budget per TDD2 §7.3 + Plan 05-01 PR-42.
 *
 * Composes with `createProviderRouter` (PR-41) — the router makes the
 * FIRST decision; the fallback chain handles retry-on-failure. When Pi
 * emits `auto_retry_503` / `auto_retry_429` / `auto_retry_500`, the
 * dispatcher calls `recordFailure(provider, reason)` and the chain
 * advances to the next provider in `fallbacks`.
 *
 * The chain is per-task scoped: each task gets a fresh chain, the
 * counter resets to zero on construction. A `retryBudget` caps the
 * total number of fallback hops across the whole task — once exhausted,
 * `select()` throws `FallbackChainExhaustedError` rather than emitting
 * yet another retry, so the dispatcher can fail the task cleanly.
 *
 * Telemetry: every fallback transition emits a `provider.fallback_fired`
 * event with `{from, to, reason, attempt}` to the injected event bus.
 * Dashboards + observability consume the events to track failure rates
 * per provider.
 *
 * **Failure-mode contract (per ADR-007 + ADR-011):**
 *   - `503` (service unavailable) + `429` (rate limit) → standard fallback
 *   - `500` (server error) → standard fallback
 *   - `other` (network timeout, malformed response, etc.) → standard fallback
 *   The dispatcher classifies the failure before calling `recordFailure`;
 *   this module doesn't peek inside Pi's `auto_retry_*` envelope.
 */

import type { TaskBrief } from '@swt-labs/shared';

export type FallbackFailureReason = '503' | '429' | '500' | 'other';

export interface FallbackChainOptions {
  /** First provider tried. */
  readonly primary: string;
  /** Ordered fallback providers tried after `primary` fails. */
  readonly fallbacks: readonly string[];
  /**
   * Maximum total attempts across the chain (including the primary).
   * When exhausted, `select()` throws `FallbackChainExhaustedError`.
   * Must be `>= 1`.
   */
  readonly retryBudget: number;
  /**
   * Plan 06-02 T2 (R4) — optional wall-clock budget. When set, the chain
   * exhausts on EITHER request-count OR elapsed wall-clock time. Either
   * exhaustion path throws `FallbackChainExhaustedError` with a `path`
   * discriminator identifying which check fired. Default behavior when
   * unset preserves the original request-count-only semantics.
   *
   * The library stays unopinionated: callers (cook.ts) supply the default
   * (30000ms at the cook callsite per REQ-15 MTTR target).
   */
  readonly timeBudgetMs?: number;
  /**
   * Plan 06-02 T2 — optional clock for deterministic tests. Default
   * `() => Date.now()`. Returns ms since epoch.
   */
  readonly clock?: () => number;
  /**
   * Optional event publisher for `provider.fallback_fired` telemetry.
   * Signature mirrors the dashboard's `EventBus.publish` shape but the
   * chain only invokes it on transitions.
   */
  readonly publish?: (event: ProviderFallbackEvent) => void;
}

export interface ProviderFallbackEvent {
  readonly type: 'provider.fallback_fired';
  readonly ts: string;
  readonly task_id: string;
  readonly from: string;
  readonly to: string;
  readonly reason: FallbackFailureReason;
  /** 1-based attempt number on the chain (1 = primary, 2 = first fallback, …). */
  readonly attempt: number;
}

export interface FallbackSelection {
  /** Provider to dispatch against on this attempt. */
  readonly provider: string;
  /** 1-based attempt number (1 = primary, 2 = first fallback, …). */
  readonly attempt: number;
  /** True when no further fallbacks remain after this one. */
  readonly isLast: boolean;
}

/**
 * Plan 06-02 T2 (R4) — dual exhaustion discriminator. `'request_count'`
 * preserves the original semantics; `'time_budget'` indicates the wall-clock
 * `timeBudgetMs` cap fired first.
 */
export type FallbackExhaustionPath = 'request_count' | 'time_budget';

export class FallbackChainExhaustedError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly attempts: number,
    public readonly retryBudget: number,
    public readonly path: FallbackExhaustionPath = 'request_count',
    public readonly elapsedMs: number = 0,
    public readonly timeBudgetMs?: number,
  ) {
    super(
      path === 'time_budget'
        ? `Fallback chain exhausted for task ${taskId}: time budget exceeded (` +
            `elapsedMs=${elapsedMs}, timeBudgetMs=${timeBudgetMs ?? 'unset'}, ` +
            `attempts=${attempts}, retryBudget=${retryBudget}).`
        : `Fallback chain exhausted for task ${taskId}: ${attempts} attempts made (budget=${retryBudget}).`,
    );
    this.name = 'FallbackChainExhaustedError';
  }
}

export interface FallbackChain {
  /**
   * Return the current provider to dispatch against. Throws
   * `FallbackChainExhaustedError` once every chain slot has been
   * exhausted (attempts === chain.length, OR attempts === retryBudget).
   */
  select(task: TaskBrief): FallbackSelection;
  /**
   * Record a failure for the current provider. Advances the internal
   * cursor + emits `provider.fallback_fired` via the publisher when one
   * is wired. Returns `true` if the chain has another provider to try,
   * `false` if exhausted.
   */
  recordFailure(provider: string, reason: FallbackFailureReason, task: TaskBrief): boolean;
  /** Number of attempts taken so far (1-based: a fresh chain reads 1 after first select). */
  attemptsTaken(): number;
}

/**
 * Construct a per-task fallback chain. The chain is single-use — once
 * exhausted, a fresh chain is required for the next task.
 */
export function createFallbackChain(opts: FallbackChainOptions): FallbackChain {
  if (opts.retryBudget < 1) {
    throw new Error(`createFallbackChain: retryBudget must be >= 1 (got ${opts.retryBudget}).`);
  }
  const sequence: readonly string[] = [opts.primary, ...opts.fallbacks];
  const publish = opts.publish;
  const maxAttempts = Math.min(sequence.length, opts.retryBudget);
  // Plan 06-02 T2 (R4) — wall-clock support.
  const clock = opts.clock ?? ((): number => Date.now());
  const timeBudgetMs = opts.timeBudgetMs;
  const startedAt = clock();

  let cursor = 0;

  const elapsedMs = (): number => clock() - startedAt;

  const throwIfTimeBudgetExceeded = (task: TaskBrief): void => {
    if (timeBudgetMs === undefined) return;
    const elapsed = elapsedMs();
    if (elapsed > timeBudgetMs) {
      throw new FallbackChainExhaustedError(
        task.taskId,
        cursor,
        opts.retryBudget,
        'time_budget',
        elapsed,
        timeBudgetMs,
      );
    }
  };

  return {
    select(task: TaskBrief): FallbackSelection {
      throwIfTimeBudgetExceeded(task);
      if (cursor >= maxAttempts) {
        throw new FallbackChainExhaustedError(
          task.taskId,
          cursor,
          opts.retryBudget,
          'request_count',
          elapsedMs(),
          timeBudgetMs,
        );
      }
      const provider = sequence[cursor] as string;
      return {
        provider,
        attempt: cursor + 1,
        isLast: cursor === maxAttempts - 1,
      };
    },
    recordFailure(provider: string, reason: FallbackFailureReason, task: TaskBrief): boolean {
      // The dispatcher records failure for the CURRENT cursor. If the
      // supplied provider doesn't match the current cursor's provider,
      // it's a programming error — but we record the failure anyway and
      // advance to maintain forward progress.
      const fromProvider = sequence[cursor];
      cursor += 1;
      // Plan 06-02 T2 (R4) — dual exhaustion: time_budget fires BEFORE
      // request_count check if both are over the limit. The order is
      // documented so the error's `path` field is deterministic.
      throwIfTimeBudgetExceeded(task);
      const hasNext = cursor < maxAttempts;
      if (hasNext && publish !== undefined) {
        const next = sequence[cursor] as string;
        publish({
          type: 'provider.fallback_fired',
          ts: new Date().toISOString(),
          task_id: task.taskId,
          from: fromProvider ?? provider,
          to: next,
          reason,
          attempt: cursor + 1,
        });
      }
      return hasNext;
    },
    attemptsTaken(): number {
      return cursor;
    },
  };
}
