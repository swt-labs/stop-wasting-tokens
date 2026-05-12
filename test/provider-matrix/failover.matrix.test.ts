/**
 * Provider-matrix failover simulation per TDD2 §14.10 + Plan 05-01 PR-44 +
 * ADR-011 (cassette-only provider matrix; no real API keys in CI).
 *
 * Exercises the M5 dispatch decision chain end-to-end:
 *
 *   1. `createProviderRouter` (PR-41) makes the FIRST decision per (task, tier).
 *   2. The dispatcher calls the provider.
 *   3. On a synthetic 503/429/500 response, the dispatcher calls
 *      `chain.recordFailure(provider, reason, task)`.
 *   4. `createFallbackChain` (PR-42) advances + emits `provider.fallback_fired`.
 *   5. The dispatcher retries on the next provider until success OR exhaustion.
 *
 * No real API keys touched. The "dispatcher" is a fake loop in this test
 * that calls a synthetic provider-side function returning either a
 * `503` reason or a successful `TaskResult`. This is the convention
 * pinned by ADR-011 — provider-matrix tests run on cassettes (or, here,
 * synthetic responses); CI never hits real APIs.
 *
 * Once user-recorded cassettes land for each provider (Anthropic /
 * OpenAI / OpenRouter / Google / Bedrock / Ollama), the same dispatch
 * loop swaps the synthetic responses for cassette-replayed turns
 * without changing the chain mechanics.
 */

import {
  FallbackChainExhaustedError,
  createFallbackChain,
  createProviderRouter,
  type FallbackFailureReason,
  type ProviderFallbackEvent,
} from '@swt-labs/orchestration';
import type { TaskBrief } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

interface SyntheticTurn {
  readonly status: 'ok' | 'error';
  readonly errorReason?: FallbackFailureReason;
  readonly provider: string;
}

/**
 * Synthetic dispatcher: walks the fallback chain until `provider-fn`
 * returns `status: 'ok'` or the chain throws `FallbackChainExhausted`.
 * Returns the turn sequence + the final outcome.
 */
function dispatchWithFallback(opts: {
  task: TaskBrief;
  chain: ReturnType<typeof createFallbackChain>;
  providerFn: (provider: string) => SyntheticTurn;
}): { turns: SyntheticTurn[]; ok: boolean } {
  const turns: SyntheticTurn[] = [];
  while (true) {
    let sel: { provider: string; attempt: number; isLast: boolean };
    try {
      sel = opts.chain.select(opts.task);
    } catch (err) {
      if (err instanceof FallbackChainExhaustedError) {
        return { turns, ok: false };
      }
      throw err;
    }
    const turn = opts.providerFn(sel.provider);
    turns.push(turn);
    if (turn.status === 'ok') return { turns, ok: true };
    const hasNext = opts.chain.recordFailure(sel.provider, turn.errorReason ?? 'other', opts.task);
    if (!hasNext) return { turns, ok: false };
  }
}

const TASK: TaskBrief = {
  taskId: 'T-failover-matrix-001',
  role: 'dev',
  cwd: '/tmp/failover-matrix',
};

describe('provider-matrix failover simulation (M5 PR-44, ADR-011)', () => {
  it('primary succeeds → no fallback fires, single turn recorded', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai', 'openrouter/anthropic/claude-opus-4-7'],
      retryBudget: 3,
      publish: (e) => events.push(e),
    });
    const result = dispatchWithFallback({
      task: TASK,
      chain,
      providerFn: (p) => ({ status: 'ok', provider: p }),
    });
    expect(result.ok).toBe(true);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.provider).toBe('anthropic');
    expect(events).toEqual([]);
  });

  it('primary 503 → fallback fires once + secondary succeeds', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai'],
      retryBudget: 2,
      publish: (e) => events.push(e),
    });
    const result = dispatchWithFallback({
      task: TASK,
      chain,
      providerFn: (p) => {
        if (p === 'anthropic') return { status: 'error', errorReason: '503', provider: p };
        return { status: 'ok', provider: p };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.turns.map((t) => t.provider)).toEqual(['anthropic', 'openai']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'provider.fallback_fired',
      task_id: 'T-failover-matrix-001',
      from: 'anthropic',
      to: 'openai',
      reason: '503',
      attempt: 2,
    });
  });

  it('full chain failure → exhaustion, no successful turn, events fire on each transition', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai', 'openrouter/anthropic/claude-opus-4-7'],
      retryBudget: 3,
      publish: (e) => events.push(e),
    });
    const result = dispatchWithFallback({
      task: TASK,
      chain,
      providerFn: (p) => ({ status: 'error', errorReason: '503', provider: p }),
    });
    expect(result.ok).toBe(false);
    expect(result.turns).toHaveLength(3);
    expect(result.turns.map((t) => t.provider)).toEqual([
      'anthropic',
      'openai',
      'openrouter/anthropic/claude-opus-4-7',
    ]);
    // 2 fallback events: anthropic→openai, openai→openrouter. The terminal
    // failure on openrouter emits no event.
    expect(events).toHaveLength(2);
    expect(events.map((e) => `${e.from}→${e.to}`)).toEqual([
      'anthropic→openai',
      'openai→openrouter/anthropic/claude-opus-4-7',
    ]);
  });

  it('router composes with fallback chain: router picks primary, chain handles retry', () => {
    const router = createProviderRouter({
      kind: 'tier-routed',
      map: {
        balanced: 'anthropic',
        quality: 'openai',
        'cheap-fast': 'openrouter/deepseek/deepseek-v3',
      },
      fallback: 'anthropic',
    });
    // For a 'balanced' task the router picks anthropic; the chain
    // starts there + falls back through openai → openrouter on 503.
    const primary = router.select({ task: TASK, tier: 'balanced' });
    expect(primary).toBe('anthropic');

    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary,
      fallbacks: ['openai', 'openrouter/deepseek/deepseek-v3'],
      retryBudget: 3,
      publish: (e) => events.push(e),
    });
    // anthropic + openai both 503; openrouter succeeds.
    const result = dispatchWithFallback({
      task: TASK,
      chain,
      providerFn: (p) => {
        if (p === 'anthropic' || p === 'openai')
          return { status: 'error', errorReason: '503', provider: p };
        return { status: 'ok', provider: p };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.turns.map((t) => t.provider)).toEqual([
      'anthropic',
      'openai',
      'openrouter/deepseek/deepseek-v3',
    ]);
    expect(events).toHaveLength(2);
  });

  it('mixed 503 + 429 + 500 reasons route through the same advance path', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'a',
      fallbacks: ['b', 'c', 'd'],
      retryBudget: 4,
      publish: (e) => events.push(e),
    });
    const reasons: FallbackFailureReason[] = ['503', '429', '500'];
    let i = 0;
    const result = dispatchWithFallback({
      task: TASK,
      chain,
      providerFn: (p) => {
        if (p === 'd') return { status: 'ok', provider: p };
        return { status: 'error', errorReason: reasons[i++], provider: p };
      },
    });
    expect(result.ok).toBe(true);
    expect(events.map((e) => e.reason)).toEqual(['503', '429', '500']);
  });

  it('retryBudget caps the chain even when more fallbacks exist', () => {
    const events: ProviderFallbackEvent[] = [];
    const chain = createFallbackChain({
      primary: 'anthropic',
      fallbacks: ['openai', 'openrouter', 'google'], // 4 providers available
      retryBudget: 2, // but only 2 attempts allowed
      publish: (e) => events.push(e),
    });
    const result = dispatchWithFallback({
      task: TASK,
      chain,
      providerFn: (p) => ({ status: 'error', errorReason: '503', provider: p }),
    });
    expect(result.ok).toBe(false);
    // Only 2 turns attempted, even though 4 providers were available.
    expect(result.turns).toHaveLength(2);
    expect(result.turns.map((t) => t.provider)).toEqual(['anthropic', 'openai']);
    // 1 fallback event (anthropic → openai); the terminal failure emits none.
    expect(events).toHaveLength(1);
    expect(events[0]?.from).toBe('anthropic');
    expect(events[0]?.to).toBe('openai');
  });
});
