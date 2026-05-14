/**
 * Phase 2 / Plan 02-02 T3 (G-R3) — cook providers config strategy mapping.
 *
 * Asserts that `toRouterStrategy` correctly maps every `CookProviderStrategy`
 * variant to its orchestration-layer `RouterStrategy` counterpart:
 *
 *   (a) The NEW `cost-optimized-rate-card` kind (plan 02-02) passes through
 *       verbatim — config shape and router shape are intentionally identical
 *       for this kind. Asserts `router.kind`, `providers`, `dimension`, and
 *       that the loaded `rateCard.entries` survive the mapping.
 *   (b) Regression guard for the additive-union backwards-compat invariant
 *       (R4 — schema bump NOT taken): the existing 4 strategy kinds
 *       (`pinned`, `round-robin`, `tier-routed`, `cost-optimized`) still
 *       map identically post-Phase-2.
 *
 * `toRouterStrategy` is exported by `cook.ts` so this test can drive it
 * directly without spinning up a full cook spawn path.
 */

import { describe, expect, it } from 'vitest';

import { toRouterStrategy, type CookProviderStrategy } from '../../src/commands/cook.js';

// Frozen fixture rate card — minimal shape, just enough to satisfy the
// RateCard-typed field of the new strategy variant.
const fixtureCard = {
  schema_version: 1 as const,
  source: 'embedded' as const,
  generated_at: '2026-05-14T00:00:00Z',
  entries: [
    {
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      input_per_1k: 0.015,
      output_per_1k: 0.075,
      updated_at: '2026-05-14T00:00:00Z',
    },
  ],
};

describe('cook providers config — strategy mapping (Phase 2 / Plan 02-02)', () => {
  it('cost-optimized-rate-card config maps to router-shape strategy (verbatim pass-through)', () => {
    const cfg: CookProviderStrategy = {
      kind: 'cost-optimized-rate-card',
      providers: ['anthropic'],
      rateCard: fixtureCard,
      dimension: 'input',
    };
    const router = toRouterStrategy(cfg);
    expect(router.kind).toBe('cost-optimized-rate-card');
    if (router.kind === 'cost-optimized-rate-card') {
      expect(router.providers).toEqual(['anthropic']);
      expect(router.dimension).toBe('input');
      expect(router.rateCard.entries.length).toBeGreaterThan(0);
      expect(router.rateCard.entries[0]!.provider).toBe('anthropic');
      // `model` was omitted in the input — must stay omitted on output
      // (preserves exactOptionalPropertyTypes-friendly shape).
      expect(router.model).toBeUndefined();
    }
  });

  it('cost-optimized-rate-card preserves `model` when supplied', () => {
    const cfg: CookProviderStrategy = {
      kind: 'cost-optimized-rate-card',
      providers: ['anthropic', 'openai'],
      rateCard: fixtureCard,
      dimension: 'blended',
      model: 'claude-opus-4-7',
    };
    const router = toRouterStrategy(cfg);
    expect(router.kind).toBe('cost-optimized-rate-card');
    if (router.kind === 'cost-optimized-rate-card') {
      expect(router.model).toBe('claude-opus-4-7');
      expect(router.dimension).toBe('blended');
    }
  });

  it('legacy strategy kinds parse identically post-Phase-2 (regression guard)', () => {
    // The four legacy variants must continue to map byte-identically so
    // existing `.swt-planning/config.json` strategy blocks keep working
    // unchanged. R4 accepted NO schema bump on the explicit basis that
    // Phase 2 is additive — this assertion is the test guard.
    const pinned: CookProviderStrategy = { kind: 'pinned', provider: 'anthropic' };
    const roundRobin: CookProviderStrategy = {
      kind: 'round-robin',
      providers: ['anthropic', 'openai'],
    };
    const tierRouted: CookProviderStrategy = {
      kind: 'tier-routed',
      map: { 'cheap-fast': 'openrouter', balanced: 'anthropic' },
      fallback: 'anthropic',
    };
    const costOptimized: CookProviderStrategy = {
      kind: 'cost-optimized',
      providers: ['anthropic', 'openai'],
      priceTable: { anthropic: 15, openai: 10 },
    };

    const pinnedR = toRouterStrategy(pinned);
    expect(pinnedR.kind).toBe('pinned');
    if (pinnedR.kind === 'pinned') {
      expect(pinnedR.provider).toBe('anthropic');
    }

    const rrR = toRouterStrategy(roundRobin);
    expect(rrR.kind).toBe('round-robin');
    if (rrR.kind === 'round-robin') {
      expect(rrR.providers).toEqual(['anthropic', 'openai']);
    }

    const trR = toRouterStrategy(tierRouted);
    expect(trR.kind).toBe('tier-routed');
    if (trR.kind === 'tier-routed') {
      // Config accepts loose Record<string,string>; router shape narrows
      // to Partial<Record<Tier,string>>. Only known tiers pass through.
      expect(trR.map['cheap-fast']).toBe('openrouter');
      expect(trR.map.balanced).toBe('anthropic');
      expect(trR.fallback).toBe('anthropic');
    }

    const coR = toRouterStrategy(costOptimized);
    expect(coR.kind).toBe('cost-optimized');
    if (coR.kind === 'cost-optimized') {
      expect(coR.providers).toEqual(['anthropic', 'openai']);
      expect(coR.priceTable).toEqual({ anthropic: 15, openai: 10 });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Phase 2 / Plan 02-03 — tier-routed-compound mapping (R2 + R3)
  // ─────────────────────────────────────────────────────────────────────

  it('tier-routed-compound config maps to router shape (known compound keys preserved, unknown dropped)', () => {
    const cfg: CookProviderStrategy = {
      kind: 'tier-routed-compound',
      map: {
        'cheap-fast': 'openrouter',
        'standard-standard': 'anthropic',
        'not-a-real-tier': 'silently-dropped',
      },
      fallback: 'anthropic',
    };
    const router = toRouterStrategy(cfg);
    expect(router.kind).toBe('tier-routed-compound');
    if (router.kind === 'tier-routed-compound') {
      expect(router.map['cheap-fast']).toBe('openrouter');
      expect(router.map['standard-standard']).toBe('anthropic');
      // Unknown keys are silently dropped (mirrors legacy tier-routed filter).
      expect((router.map as Record<string, string>)['not-a-real-tier']).toBeUndefined();
      expect(router.fallback).toBe('anthropic');
      expect(router.fallbackStrategy).toBeUndefined();
    }
  });

  it('tier-routed-compound with recursive fallbackStrategy maps the inner strategy correctly', () => {
    // Inner strategy reuses the cost-optimized-rate-card fixture card from
    // the top of this file. The cook config layer allows OPEN recursion
    // (any CookProviderStrategy as fallbackStrategy); the router-layer
    // Exclude<...> bound catches nested tier-routed-compound (R3).
    const cfg: CookProviderStrategy = {
      kind: 'tier-routed-compound',
      map: { 'cheap-fast': 'openrouter' },
      fallback: 'anthropic',
      fallbackStrategy: {
        kind: 'cost-optimized-rate-card',
        providers: ['anthropic'],
        rateCard: fixtureCard,
        dimension: 'input',
      },
    };
    const router = toRouterStrategy(cfg);
    expect(router.kind).toBe('tier-routed-compound');
    if (router.kind === 'tier-routed-compound') {
      expect(router.fallbackStrategy).toBeDefined();
      // The inner strategy must round-trip the kind discriminator unchanged.
      expect(router.fallbackStrategy?.kind).toBe('cost-optimized-rate-card');
      if (router.fallbackStrategy?.kind === 'cost-optimized-rate-card') {
        expect(router.fallbackStrategy.providers).toEqual(['anthropic']);
        expect(router.fallbackStrategy.dimension).toBe('input');
      }
    }
  });
});
