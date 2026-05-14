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

describe('createProviderRouter — cost-optimized-rate-card (Phase 2 / G-R3)', () => {
  // Frozen test fixture rate card. Inline values DO NOT need to match real
  // 2026 vendor pricing — the strategy logic only cares about the relative
  // ordering of per-1k values per dimension.
  //
  // anthropic: high input ($15) / low output ($0.5)
  // openai:    mid both        ($10 / $10)
  // openrouter: low input ($0.5) / high output ($15)
  //
  // These asymmetries let each describe-block assertion pin a specific
  // provider per dimension without depending on the embedded snapshot
  // (which can shift across rate-card refreshes).
  const fixtureCard = {
    schema_version: 1 as const,
    source: 'embedded' as const,
    generated_at: '2026-05-14T00:00:00Z',
    entries: [
      {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        input_per_1k: 15.0,
        output_per_1k: 0.5,
        updated_at: '2026-05-14T00:00:00Z',
      },
      {
        provider: 'openai',
        model: 'gpt-5',
        input_per_1k: 10.0,
        output_per_1k: 10.0,
        updated_at: '2026-05-14T00:00:00Z',
      },
      {
        provider: 'openrouter',
        model: 'openrouter/anthropic/claude-opus-4-7',
        input_per_1k: 0.5,
        output_per_1k: 15.0,
        updated_at: '2026-05-14T00:00:00Z',
      },
    ],
  };

  it('picks cheapest by input dimension', () => {
    const router = createProviderRouter({
      kind: 'cost-optimized-rate-card',
      providers: ['anthropic', 'openai', 'openrouter'],
      rateCard: fixtureCard,
      dimension: 'input',
    });
    // openrouter input_per_1k=0.5 is lowest.
    expect(router.select(ctx('balanced'))).toBe('openrouter');
  });

  it('picks cheapest by output dimension', () => {
    const router = createProviderRouter({
      kind: 'cost-optimized-rate-card',
      providers: ['anthropic', 'openai', 'openrouter'],
      rateCard: fixtureCard,
      dimension: 'output',
    });
    // anthropic output_per_1k=0.5 is lowest.
    expect(router.select(ctx('balanced'))).toBe('anthropic');
  });

  it('picks cheapest by blended dimension (first wins on tie)', () => {
    // Blended averages: anthropic=(15+0.5)/2=7.75, openai=10, openrouter=(0.5+15)/2=7.75.
    // anthropic + openrouter tie at 7.75 — strict `<` keeps the FIRST
    // ('anthropic') as best.
    const router = createProviderRouter({
      kind: 'cost-optimized-rate-card',
      providers: ['anthropic', 'openai', 'openrouter'],
      rateCard: fixtureCard,
      dimension: 'blended',
    });
    expect(router.select(ctx('balanced'))).toBe('anthropic');
  });

  it('missing model maps to Infinity (excluded from selection)', () => {
    // Request claude-opus-4-7 explicitly — only anthropic has an entry
    // matching THAT model; openai (gpt-5) and openrouter (openrouter/...)
    // entries do NOT match → both return Infinity → anthropic wins even
    // though its input_per_1k=15 is the highest of the three.
    const router = createProviderRouter({
      kind: 'cost-optimized-rate-card',
      providers: ['anthropic', 'openai', 'openrouter'],
      rateCard: fixtureCard,
      dimension: 'input',
      model: 'claude-opus-4-7',
    });
    expect(router.select(ctx('balanced'))).toBe('anthropic');
  });

  it('throws on empty providers list at construction', () => {
    expect(() =>
      createProviderRouter({
        kind: 'cost-optimized-rate-card',
        providers: [],
        rateCard: fixtureCard,
        dimension: 'input',
      }),
    ).toThrow(/non-empty providers/);
  });

  it('breaks ties by selection order (first match wins)', () => {
    // Override fixture entries so anthropic + openai both have
    // input_per_1k=5.0 — first in `providers` should win.
    const tieCard = {
      ...fixtureCard,
      entries: [
        { ...fixtureCard.entries[0]!, input_per_1k: 5.0 },
        { ...fixtureCard.entries[1]!, input_per_1k: 5.0 },
        fixtureCard.entries[2]!,
      ],
    };
    const router = createProviderRouter({
      kind: 'cost-optimized-rate-card',
      providers: ['anthropic', 'openai'],
      rateCard: tieCard,
      dimension: 'input',
    });
    expect(router.select(ctx('balanced'))).toBe('anthropic');
  });
});
