/**
 * `createFallbackChain` tests per Plan 05-01 PR-42.
 *
 * Coverage:
 *   - Happy path: primary works, no fallback fires.
 *   - Single fallback fires on a 503 — provider.fallback_fired event records.
 *   - Multiple sequential fallbacks; events fire in order.
 *   - Exhaustion: every provider fails → FallbackChainExhaustedError thrown.
 *   - retryBudget caps the chain shorter than the providers list.
 *   - Construction validation (retryBudget >= 1).
 *   - No publisher wired → no events emitted but state still advances.
 */

import type { TaskBrief } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  createFallbackChain,
  FallbackChainExhaustedError,
  type ProviderFallbackEvent,
} from '../src/provider-fallback.js';

const TASK: TaskBrief = {
  taskId: 'T-fallback-test',
  role: 'dev',
  cwd: '/tmp/fallback',
};

describe('createFallbackChain — happy path (M5 PR-42)', () => {
  it('returns the primary on first select; never advances when no failure recorded', () => {
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai', 'openrouter'],
      retryBudget: 3,
    });
    expect(chain.select(TASK)).toEqual({
      provider: 'anthropic',
      attempt: 1,
      isLast: false,
    });
    // Repeat select() without recordFailure → still primary.
    expect(chain.select(TASK)).toEqual({
      provider: 'anthropic',
      attempt: 1,
      isLast: false,
    });
    expect(chain.attemptsTaken()).toBe(0);
  });
});

describe('createFallbackChain — single fallback (M5 PR-42)', () => {
  it('advances to the next provider + fires provider.fallback_fired on 503', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai'],
      retryBudget: 2,
      publish: (e) => events.push(e),
    });
    expect(chain.select(TASK).provider).toBe('anthropic');

    const hasNext = chain.recordFailure('anthropic', '503', TASK);
    expect(hasNext).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'provider.fallback_fired',
      task_id: 'T-fallback-test',
      from: 'anthropic',
      to: 'openai',
      reason: '503',
      attempt: 2,
    });

    expect(chain.select(TASK)).toEqual({
      provider: 'openai',
      attempt: 2,
      isLast: true,
    });
  });

  it('fires on 429 and 500 with the correct reason', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain429 = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai'],
      retryBudget: 2,
      publish: (e) => events.push(e),
    });
    chain429.select(TASK);
    chain429.recordFailure('anthropic', '429', TASK);
    expect(events[0]?.reason).toBe('429');

    const events500: ProviderFallbackEvent[] = [];
    const chain500 = createFallbackChain({
      primary: 'a',
      fallbacks: ['b'],
      retryBudget: 2,
      publish: (e) => events500.push(e),
    });
    chain500.select(TASK);
    chain500.recordFailure('a', '500', TASK);
    expect(events500[0]?.reason).toBe('500');
  });
});

describe('createFallbackChain — multiple sequential fallbacks (M5 PR-42)', () => {
  it('walks through all providers in order; events fire in sequence', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai', 'openrouter'],
      retryBudget: 3,
      publish: (e) => events.push(e),
    });

    expect(chain.select(TASK).provider).toBe('anthropic');
    chain.recordFailure('anthropic', '503', TASK);
    expect(chain.select(TASK).provider).toBe('openai');
    chain.recordFailure('openai', '500', TASK);
    expect(chain.select(TASK)).toEqual({
      provider: 'openrouter',
      attempt: 3,
      isLast: true,
    });

    expect(events.map((e) => `${e.from}->${e.to}(${e.reason})`)).toEqual([
      'anthropic->openai(503)',
      'openai->openrouter(500)',
    ]);
  });
});

describe('createFallbackChain — exhaustion (M5 PR-42)', () => {
  it('throws FallbackChainExhaustedError after every provider has failed', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'a',
      fallbacks: ['b'],
      retryBudget: 2,
      publish: (e) => events.push(e),
    });
    chain.select(TASK);
    chain.recordFailure('a', '503', TASK);
    chain.select(TASK);
    expect(chain.recordFailure('b', 'other', TASK)).toBe(false);
    // No fallback event on the final failure (no provider to fall back to).
    expect(events).toHaveLength(1);

    expect(() => chain.select(TASK)).toThrow(FallbackChainExhaustedError);
    try {
      chain.select(TASK);
    } catch (err) {
      expect(err).toBeInstanceOf(FallbackChainExhaustedError);
      const e = err as FallbackChainExhaustedError;
      expect(e.taskId).toBe('T-fallback-test');
      expect(e.attempts).toBe(2);
      expect(e.retryBudget).toBe(2);
    }
  });

  it('honours retryBudget < providers.length (caps the chain)', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'a',
      fallbacks: ['b', 'c', 'd'],
      retryBudget: 2, // budget < 4 available providers
      publish: (e) => events.push(e),
    });
    expect(chain.select(TASK).provider).toBe('a');
    chain.recordFailure('a', '503', TASK);
    expect(chain.select(TASK)).toEqual({
      provider: 'b',
      attempt: 2,
      isLast: true, // budget says no more after this
    });
    expect(chain.recordFailure('b', '503', TASK)).toBe(false);
    expect(() => chain.select(TASK)).toThrow(FallbackChainExhaustedError);
    // c + d were never used.
    expect(events).toHaveLength(1);
    expect(events[0]?.to).toBe('b');
  });
});

describe('createFallbackChain — construction validation (M5 PR-42)', () => {
  it('throws when retryBudget < 1', () => {
    expect(() =>
      createFallbackChain({
        primary: 'a',
        fallbacks: [],
        retryBudget: 0,
      }),
    ).toThrow(/retryBudget must be >= 1/);
    expect(() =>
      createFallbackChain({
        primary: 'a',
        fallbacks: [],
        retryBudget: -1,
      }),
    ).toThrow(/retryBudget must be >= 1/);
  });

  it('accepts a chain with no fallbacks (primary-only, retryBudget=1)', () => {
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: [],
      retryBudget: 1,
    });
    const sel = chain.select(TASK);
    expect(sel).toEqual({
      provider: 'anthropic',
      attempt: 1,
      isLast: true, // only provider in chain
    });
    expect(chain.recordFailure('anthropic', '503', TASK)).toBe(false);
    expect(() => chain.select(TASK)).toThrow(FallbackChainExhaustedError);
  });
});

describe('createFallbackChain — no publisher (M5 PR-42)', () => {
  it('advances state correctly without emitting events when publish is omitted', () => {
    const chain = createFallbackChain({
      primary: 'a',
      fallbacks: ['b'],
      retryBudget: 2,
      // No `publish`
    });
    expect(chain.select(TASK).provider).toBe('a');
    expect(chain.recordFailure('a', '503', TASK)).toBe(true);
    expect(chain.select(TASK).provider).toBe('b');
  });
});
