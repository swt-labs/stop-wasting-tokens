/**
 * Plan 06-02 T2 (R4) — `createFallbackChain` timeBudgetMs tests.
 *
 * Coverage:
 *   1. Within budget — recordFailure advances without throwing.
 *   2. Over budget on subsequent recordFailure → throws with
 *      `path: 'time_budget'`.
 *   3. timeBudgetMs unset → original request_count semantics preserved.
 *   4. Both budgets exhausted simultaneously → time_budget wins per
 *      documented order.
 */

import type { TaskBrief } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  createFallbackChain,
  FallbackChainExhaustedError,
} from '../src/provider-fallback.js';

const TASK: TaskBrief = {
  taskId: 'T-time-budget',
  role: 'dev',
  cwd: '/tmp/tb',
};

function makeStepClock(steps: number[]): () => number {
  let i = 0;
  return () => {
    const v = steps[Math.min(i, steps.length - 1)] ?? 0;
    i += 1;
    return v;
  };
}

describe('createFallbackChain — timeBudgetMs (Plan 06-02 T2, R4)', () => {
  it('advances normally when failures land within the wall-clock budget', () => {
    // Clock sequence: 0 (start), 50 (first recordFailure check) — within 100ms budget.
    const clock = makeStepClock([0, 50, 60]);
    const chain = createFallbackChain({
      primary: 'p1',
      fallbacks: ['p2', 'p3'],
      retryBudget: 5,
      timeBudgetMs: 100,
      clock,
    });
    expect(chain.select(TASK).provider).toBe('p1');
    const hasNext = chain.recordFailure('p1', '503', TASK);
    expect(hasNext).toBe(true);
    expect(chain.select(TASK).provider).toBe('p2');
  });

  it('throws FallbackChainExhaustedError with path="time_budget" when elapsed > timeBudgetMs', () => {
    // Clock sequence:
    //   t=0   start (constructor)
    //   t=50  first select (within budget)
    //   t=60  recordFailure -> throwIfTimeBudgetExceeded check (60>100? no)
    //   t=110 second recordFailure -> throwIfTimeBudgetExceeded after cursor++ (110>100? yes)
    // Plus the initial throwIfTimeBudgetExceeded inside the first recordFailure
    // also reads the clock; arrange enough values for both.
    const clock = makeStepClock([0, 50, 60, 70, 110, 120, 130]);
    const chain = createFallbackChain({
      primary: 'p1',
      fallbacks: ['p2', 'p3'],
      retryBudget: 5,
      timeBudgetMs: 100,
      clock,
    });
    chain.select(TASK); // attempt 1 — t=50
    chain.recordFailure('p1', '503', TASK); // cursor -> 1, clock=60 — within budget
    chain.select(TASK); // attempt 2 — clock=70

    let caught: FallbackChainExhaustedError | undefined;
    try {
      chain.recordFailure('p2', '503', TASK); // cursor -> 2, clock check at t=110+ > 100
    } catch (err) {
      caught = err as FallbackChainExhaustedError;
    }
    expect(caught).toBeInstanceOf(FallbackChainExhaustedError);
    expect(caught?.path).toBe('time_budget');
    expect(caught?.timeBudgetMs).toBe(100);
    expect(caught?.elapsedMs).toBeGreaterThan(100);
  });

  it('preserves original request_count semantics when timeBudgetMs is unset', () => {
    const chain = createFallbackChain({
      primary: 'a',
      fallbacks: ['b'],
      retryBudget: 1, // budget < providers
    });
    expect(chain.select(TASK).provider).toBe('a');
    const hasNext = chain.recordFailure('a', '503', TASK);
    expect(hasNext).toBe(false);
    let caught: FallbackChainExhaustedError | undefined;
    try {
      chain.select(TASK);
    } catch (err) {
      caught = err as FallbackChainExhaustedError;
    }
    expect(caught).toBeInstanceOf(FallbackChainExhaustedError);
    expect(caught?.path).toBe('request_count');
  });

  it('when both budgets exhausted, time_budget wins (documented order)', () => {
    // retryBudget=1 (one attempt) + timeBudgetMs=10 with clock at 50 on the
    // first recordFailure → time_budget check runs FIRST inside the
    // recordFailure body (after cursor++) and throws before the request_count
    // path could re-trigger on next select().
    const clock = makeStepClock([0, 5, 50, 60]);
    const chain = createFallbackChain({
      primary: 'a',
      fallbacks: [],
      retryBudget: 1,
      timeBudgetMs: 10,
      clock,
    });
    expect(chain.select(TASK).provider).toBe('a'); // clock=5
    let caught: FallbackChainExhaustedError | undefined;
    try {
      chain.recordFailure('a', '503', TASK); // throwIfTimeBudgetExceeded -> 50>10
    } catch (err) {
      caught = err as FallbackChainExhaustedError;
    }
    expect(caught).toBeInstanceOf(FallbackChainExhaustedError);
    expect(caught?.path).toBe('time_budget');
  });
});
