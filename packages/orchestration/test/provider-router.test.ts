/**
 * `createProviderRouter` tests per Plan 05-01 PR-41.
 *
 * Four strategies, each with happy + edge-case coverage:
 *   - pinned (always returns one provider)
 *   - round-robin (cycles through ordered list; injected counter for determinism)
 *   - tier-routed (per-tier map + fallback)
 *   - cost-optimized (cheapest from candidate list)
 */

import type { TaskBrief } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  createProviderRouter,
  type RouterSelectionContext,
  type Tier,
} from '../src/provider-router.js';

const TASK: TaskBrief = {
  taskId: 'T-router-test',
  role: 'dev',
  cwd: '/tmp/router',
};

function ctx(tier: Tier): RouterSelectionContext {
  return { task: TASK, tier };
}

describe('createProviderRouter — pinned (M5 PR-41)', () => {
  it('always returns the same provider regardless of tier', () => {
    const router = createProviderRouter({ kind: 'pinned', provider: 'anthropic' });
    expect(router.select(ctx('cheap-fast'))).toBe('anthropic');
    expect(router.select(ctx('balanced'))).toBe('anthropic');
    expect(router.select(ctx('quality'))).toBe('anthropic');
    expect(router.select(ctx('reasoning'))).toBe('anthropic');
  });
});

describe('createProviderRouter — round-robin (M5 PR-41)', () => {
  it('cycles through providers in order via internal counter', () => {
    const router = createProviderRouter({
      kind: 'round-robin',
      providers: ['anthropic', 'openai', 'openrouter'],
    });
    const seq = [
      router.select(ctx('balanced')),
      router.select(ctx('balanced')),
      router.select(ctx('balanced')),
      router.select(ctx('balanced')),
      router.select(ctx('balanced')),
      router.select(ctx('balanced')),
    ];
    expect(seq).toEqual(['anthropic', 'openai', 'openrouter', 'anthropic', 'openai', 'openrouter']);
  });

  it('respects an injected counter for deterministic test sequencing', () => {
    let n = 5;
    const router = createProviderRouter({
      kind: 'round-robin',
      providers: ['a', 'b', 'c'],
      counter: () => n++,
    });
    // Start at 5, 6, 7 → indices 2, 0, 1.
    expect(router.select(ctx('balanced'))).toBe('c');
    expect(router.select(ctx('balanced'))).toBe('a');
    expect(router.select(ctx('balanced'))).toBe('b');
  });

  it('throws on empty providers list at construction', () => {
    expect(() =>
      createProviderRouter({
        kind: 'round-robin',
        providers: [],
      }),
    ).toThrow(/non-empty providers/);
  });

  it('handles a single-provider list by repeating that provider', () => {
    const router = createProviderRouter({
      kind: 'round-robin',
      providers: ['solo'],
    });
    expect(router.select(ctx('balanced'))).toBe('solo');
    expect(router.select(ctx('balanced'))).toBe('solo');
  });
});

describe('createProviderRouter — tier-routed (M5 PR-41)', () => {
  it('returns the mapped provider per tier', () => {
    const router = createProviderRouter({
      kind: 'tier-routed',
      map: {
        'cheap-fast': 'openrouter',
        balanced: 'anthropic',
        quality: 'anthropic',
        reasoning: 'openai',
      },
      fallback: 'anthropic',
    });
    expect(router.select(ctx('cheap-fast'))).toBe('openrouter');
    expect(router.select(ctx('balanced'))).toBe('anthropic');
    expect(router.select(ctx('quality'))).toBe('anthropic');
    expect(router.select(ctx('reasoning'))).toBe('openai');
  });

  it('falls back when a tier is not in the map', () => {
    const router = createProviderRouter({
      kind: 'tier-routed',
      map: {
        balanced: 'anthropic',
      },
      fallback: 'openai',
    });
    expect(router.select(ctx('balanced'))).toBe('anthropic');
    expect(router.select(ctx('cheap-fast'))).toBe('openai');
    expect(router.select(ctx('quality'))).toBe('openai');
    expect(router.select(ctx('reasoning'))).toBe('openai');
  });

  it('handles an empty map by always falling back', () => {
    const router = createProviderRouter({
      kind: 'tier-routed',
      map: {},
      fallback: 'anthropic',
    });
    expect(router.select(ctx('cheap-fast'))).toBe('anthropic');
    expect(router.select(ctx('reasoning'))).toBe('anthropic');
  });
});

describe('createProviderRouter — cost-optimized (M5 PR-41)', () => {
  it('returns the cheapest provider from the candidate list', () => {
    const router = createProviderRouter({
      kind: 'cost-optimized',
      providers: ['anthropic', 'openai', 'openrouter'],
      priceTable: {
        anthropic: 15.0,
        openai: 10.0,
        openrouter: 0.5,
      },
    });
    expect(router.select(ctx('balanced'))).toBe('openrouter');
  });

  it('uses Infinity for providers missing from the price table (falls back to others)', () => {
    const router = createProviderRouter({
      kind: 'cost-optimized',
      providers: ['unknown', 'anthropic'],
      priceTable: {
        anthropic: 15.0,
      },
    });
    // `unknown` has no price → Infinity → anthropic wins.
    expect(router.select(ctx('balanced'))).toBe('anthropic');
  });

  it('breaks ties by selection order (first match wins)', () => {
    const router = createProviderRouter({
      kind: 'cost-optimized',
      providers: ['a', 'b', 'c'],
      priceTable: { a: 5, b: 5, c: 5 },
    });
    // All same price → first stays as cheapest (strict `<` comparison).
    expect(router.select(ctx('balanced'))).toBe('a');
  });

  it('throws on empty providers list at construction', () => {
    expect(() =>
      createProviderRouter({
        kind: 'cost-optimized',
        providers: [],
        priceTable: {},
      }),
    ).toThrow(/non-empty providers/);
  });

  it('returns the only provider when there is just one candidate', () => {
    const router = createProviderRouter({
      kind: 'cost-optimized',
      providers: ['anthropic'],
      priceTable: { anthropic: 15.0 },
    });
    expect(router.select(ctx('balanced'))).toBe('anthropic');
  });
});
