/**
 * Provider router strategies per TDD2 §7.3 + Plan 05-01 PR-41.
 *
 * Given a `RouterSelectionContext` (task + resolved tier), pick a provider.
 * Four strategies cover the M5 deployment patterns:
 *
 *   - `pinned`: always returns one provider. The default for development
 *     + cassette-driven regression runs where the cassette only knows one
 *     provider's wire format.
 *   - `round-robin`: cycles through an ordered list. Used to fan out a
 *     parallel batch across providers for load + cost averaging. An
 *     injected counter makes the selection deterministic in tests.
 *   - `tier-routed`: maps `Tier → provider` so e.g. `cheap-fast` runs on
 *     OpenRouter (free DeepSeek), `balanced` runs on Anthropic, `quality`
 *     runs on whoever is best for that tier today. A `fallback` provider
 *     covers tiers not explicitly mapped.
 *   - `cost-optimized`: returns the cheapest provider from a candidate
 *     list according to a price table. Pairs with the per-provider cost
 *     panel (PR-43) so operators see why each task got which provider.
 *
 * All four strategies are pure stateless selectors. Composition with the
 * fallback chain (PR-42) is what handles provider failure — the router
 * makes the FIRST decision; the fallback chain handles retry.
 *
 * Per Principle 1: this module is in the orchestration layer. It speaks
 * vendor-agnostic provider IDs as strings (`anthropic`, `openai`,
 * `openrouter/anthropic/claude-opus-4-7`, etc.). The runtime layer is
 * responsible for interpreting those into Pi-bound wire calls.
 */

import type { RateCard, TaskBrief } from '@swt-labs/shared';
import { z } from 'zod';

export type Tier = 'cheap-fast' | 'balanced' | 'quality' | 'reasoning';

/**
 * Compound tier vocabulary for `tier-routed-compound` strategy (Phase 2 / G-R3).
 *
 * Axes:
 *   - cost  ∈ {cheap, standard, premium}
 *   - speed ∈ {fast, standard, slow}
 *   - model-class (axis-orthogonal) ∈ {reasoning}
 *
 * The set is intentionally a CURATED subset of the 3×3 cost×speed grid:
 *   - `premium-fast` excluded — no model is both top-tier AND latency-optimised today.
 *   - `cheap-slow` excluded — cheap models are inherently fast; no use case.
 *
 * Legacy `Tier` values (`'balanced'`, `'quality'`) are preserved as accepted
 * aliases so Phase 6 configs continue to work — they map naturally onto the
 * 2D grid (`balanced` ≈ `standard-standard`; `quality` ≈ `standard-slow`).
 * The other two legacy `Tier` values (`'cheap-fast'`, `'reasoning'`) are
 * already part of the compound vocabulary above.
 *
 * The legacy `Tier` type at line 33 (4 elements) stays unchanged; this is an
 * additive widening for the new `tier-routed-compound` strategy.
 *
 * Final unique list: 10 strings (7 compound + 1 model-class hint + 2 legacy
 * aliases not already in the compound grid).
 */
export type CompoundTier =
  | 'cheap-fast'
  | 'cheap-standard'
  | 'standard-fast'
  | 'standard-standard'
  | 'standard-slow'
  | 'premium-standard'
  | 'premium-slow'
  | 'reasoning'
  // Legacy aliases (preserve Phase 6 Tier compat):
  | 'balanced'
  | 'quality';

/**
 * Zod schema mirroring `CompoundTier`. Exported for config-layer validators
 * and external consumers that want runtime validation. Kept in lockstep with
 * the type union above — both list EXACTLY the same 10 strings in the same
 * order. The `as const` here is unnecessary (z.enum infers literal types
 * already) but the array ordering is a load-bearing contract documented in
 * `docs/operations/provider-routing.md`.
 */
export const CompoundTierSchema = z.enum([
  'cheap-fast',
  'cheap-standard',
  'standard-fast',
  'standard-standard',
  'standard-slow',
  'premium-standard',
  'premium-slow',
  'reasoning',
  'balanced',
  'quality',
]);

export interface RouterSelectionContext {
  /** The task being dispatched. The router may inspect `role` or `claims`. */
  readonly task: TaskBrief;
  /** Resolved tier for the role per `resolveTierForRole` (runtime layer). */
  readonly tier: Tier;
}

export type RouterStrategy =
  | { readonly kind: 'pinned'; readonly provider: string }
  | {
      readonly kind: 'round-robin';
      readonly providers: readonly string[];
      /** Injected counter for deterministic tests. Default: internal state. */
      readonly counter?: () => number;
    }
  | {
      readonly kind: 'tier-routed';
      /** Per-tier provider preference. Tiers not in the map fall back. */
      readonly map: Readonly<Partial<Record<Tier, string>>>;
      /** Provider used when `ctx.tier` is not in `map`. */
      readonly fallback: string;
    }
  | {
      readonly kind: 'cost-optimized';
      /** Candidate providers; the cheapest is selected per call. */
      readonly providers: readonly string[];
      /** Per-provider price (USD per million tokens, or any normalized unit). */
      readonly priceTable: Readonly<Record<string, number>>;
    }
  | {
      /**
       * Phase 2 / G-R3 — picks the cheapest provider from `providers` by
       * looking up per-1k pricing in a schema-validated `RateCard` (loaded
       * via `@swt-labs/runtime`'s `createRateCardSource`, plan 02-01).
       * Missing entries (provider not in card OR model mismatch when
       * `model` is supplied) fall through to `Infinity` (excluded). Empty
       * `providers` throws (mirrors the legacy `cost-optimized` contract).
       *
       * `dimension` controls which axis to minimize:
       *   - 'input'   — input_per_1k only.
       *   - 'output'  — output_per_1k only.
       *   - 'blended' — (input_per_1k + output_per_1k) / 2.
       *
       * `model` optionally pins lookup to a specific (provider, model)
       * pair; when undefined, the FIRST entry matching `provider` is used
       * (deterministic by array order). Strict `<` comparison preserves
       * the existing first-wins tie-break behavior from `cost-optimized`.
       */
      readonly kind: 'cost-optimized-rate-card';
      readonly providers: readonly string[];
      readonly rateCard: RateCard;
      readonly dimension: 'input' | 'output' | 'blended';
      readonly model?: string;
    }
  | {
      /**
       * Tier-routed with compound tier vocabulary (Phase 2 / G-R3, R2 decision).
       *
       * Resolution order:
       *   1. `map[ctx.tier]` — if present, return it.
       *   2. `fallbackStrategy` — if supplied, delegate (R3 bounded depth-1
       *      recursion; the type bound `Exclude<RouterStrategy, {kind:
       *      'tier-routed-compound'}>` prevents nesting).
       *   3. `fallback` — return the literal fallback provider id.
       *
       * `ctx.tier` is cast from `Tier` to `CompoundTier` at lookup time; the
       * legacy `RouterSelectionContext.tier` typing is preserved. All 4 legacy
       * `Tier` values are valid `CompoundTier` members so the cast is
       * semantically safe.
       */
      readonly kind: 'tier-routed-compound';
      readonly map: Readonly<Partial<Record<CompoundTier, string>>>;
      readonly fallback: string;
      readonly fallbackStrategy?: Exclude<
        RouterStrategy,
        { readonly kind: 'tier-routed-compound' }
      >;
    };

/**
 * Strategy provenance for the selection event (Phase 2 / G-R3, plan 02-04).
 * Matches the `selected_via` enum in `CookProviderSelectedEventSchema`
 * (`@swt-labs/shared` events.ts) 1:1. The
 * `'tier-routed-compound:fallback-strategy'` composition hint distinguishes a
 * `tier-routed-compound` map-hit from a `fallbackStrategy` delegation per R3.
 */
export type SelectedVia =
  | 'pinned'
  | 'round-robin'
  | 'tier-routed'
  | 'cost-optimized'
  | 'tier-routed-compound'
  | 'cost-optimized-rate-card'
  | 'tier-routed-compound:fallback-strategy';

/**
 * Provenance metadata returned by `ProviderRouter.selectWithMetadata` — the
 * provider plus the strategy-specific fields the cook telemetry layer emits
 * onto `cook.provider_selected`. The optional fields are populated only by
 * the strategy variants that carry them (`tier` for tier-routed variants,
 * `dimension` + `rate_card_source` for `cost-optimized-rate-card`).
 *
 * `rate_card_age_ms` is intentionally NOT on this shape — the orchestration
 * layer has no clock; the cook callsite computes age from the strategy's
 * `rateCard.entries[*].updated_at` timestamps (plan 02-04 T3).
 */
export interface SelectionMetadata {
  readonly provider: string;
  readonly selected_via: SelectedVia;
  readonly tier?: string;
  readonly rate_card_source?: 'embedded' | 'project-override' | 'fetched';
  readonly dimension?: 'input' | 'output' | 'blended';
}

export interface ProviderRouter {
  /** Returns the provider id selected for the supplied context. */
  select(ctx: RouterSelectionContext): string;
  /**
   * Same selection as `select(ctx)` but returns provenance metadata for
   * telemetry (Phase 2 / G-R3). OPTIONAL — pre-Phase-2 callers using
   * `select(ctx)` see byte-identical behaviour. Callers MUST invoke EITHER
   * `select` OR `selectWithMetadata` per spawn, never both: for the
   * `round-robin` strategy each call advances the internal counter, so
   * calling both would skip a provider.
   */
  selectWithMetadata?(ctx: RouterSelectionContext): SelectionMetadata;
}

/**
 * Construct a router from a strategy spec. Empty `providers` arrays
 * throw at construction time so misconfigurations surface before the
 * first dispatch.
 */
export function createProviderRouter(strategy: RouterStrategy): ProviderRouter {
  switch (strategy.kind) {
    case 'pinned': {
      const pinned = strategy.provider;
      return {
        select: () => pinned,
        selectWithMetadata: () => ({ provider: pinned, selected_via: 'pinned' }),
      };
    }
    case 'round-robin': {
      if (strategy.providers.length === 0) {
        throw new Error("createProviderRouter: 'round-robin' requires a non-empty providers list.");
      }
      const providers = strategy.providers;
      let internal = 0;
      const counter = strategy.counter ?? ((): number => internal++);
      // Single selection step — advances the counter exactly once per call.
      // `select` and `selectWithMetadata` each call this once; callers pick
      // one per spawn (see ProviderRouter JSDoc).
      const pick = (): string => {
        const i = counter();
        // Modulo guards negative counters (theoretical only).
        const idx = ((i % providers.length) + providers.length) % providers.length;
        return providers[idx] as string;
      };
      return {
        select: () => pick(),
        selectWithMetadata: () => ({ provider: pick(), selected_via: 'round-robin' }),
      };
    }
    case 'tier-routed': {
      const map = strategy.map;
      const fallback = strategy.fallback;
      return {
        select: (ctx) => map[ctx.tier] ?? fallback,
        selectWithMetadata: (ctx) => ({
          provider: map[ctx.tier] ?? fallback,
          selected_via: 'tier-routed',
          tier: ctx.tier,
        }),
      };
    }
    case 'cost-optimized': {
      if (strategy.providers.length === 0) {
        throw new Error(
          "createProviderRouter: 'cost-optimized' requires a non-empty providers list.",
        );
      }
      const providers = strategy.providers;
      const priceTable = strategy.priceTable;
      const pick = (): string => {
        let cheapest = providers[0] as string;
        let cheapestPrice = priceTable[cheapest] ?? Number.POSITIVE_INFINITY;
        for (let i = 1; i < providers.length; i++) {
          const p = providers[i] as string;
          const price = priceTable[p] ?? Number.POSITIVE_INFINITY;
          if (price < cheapestPrice) {
            cheapest = p;
            cheapestPrice = price;
          }
        }
        return cheapest;
      };
      return {
        select: () => pick(),
        selectWithMetadata: () => ({ provider: pick(), selected_via: 'cost-optimized' }),
      };
    }
    case 'cost-optimized-rate-card': {
      if (strategy.providers.length === 0) {
        throw new Error(
          "createProviderRouter: 'cost-optimized-rate-card' requires a non-empty providers list.",
        );
      }
      const providers = strategy.providers;
      const rateCard = strategy.rateCard;
      const dimension = strategy.dimension;
      const model = strategy.model;
      const costFor = (provider: string): number => {
        const entry = rateCard.entries.find(
          (e) => e.provider === provider && (model === undefined || e.model === model),
        );
        if (entry === undefined) {
          return Number.POSITIVE_INFINITY;
        }
        if (dimension === 'input') return entry.input_per_1k;
        if (dimension === 'output') return entry.output_per_1k;
        // 'blended' — equal weight on input + output per-1k.
        return (entry.input_per_1k + entry.output_per_1k) / 2;
      };
      const pick = (): string => {
        let best = providers[0] as string;
        let bestCost = costFor(best);
        for (let i = 1; i < providers.length; i++) {
          const p = providers[i] as string;
          const c = costFor(p);
          if (c < bestCost) {
            best = p;
            bestCost = c;
          }
        }
        return best;
      };
      return {
        select: () => pick(),
        selectWithMetadata: () => ({
          provider: pick(),
          selected_via: 'cost-optimized-rate-card',
          dimension,
          rate_card_source: rateCard.source,
        }),
      };
    }
    case 'tier-routed-compound': {
      // Phase 2 / G-R3 R2 + R3 — resolution order: map hit → fallbackStrategy
      // delegate → fallback literal. The fallbackStrategy type bound
      // (`Exclude<RouterStrategy, {kind:'tier-routed-compound'}>`) enforces
      // depth-1 recursion at compile time; no runtime check needed.
      const map = strategy.map;
      const fallback = strategy.fallback;
      const fallbackStrategy = strategy.fallbackStrategy;
      return {
        select: (ctx) => {
          // ctx.tier is typed `Tier` (legacy 4-element); cast to CompoundTier
          // for lookup. All legacy Tier values are valid CompoundTier members
          // (`cheap-fast`, `balanced`, `quality`, `reasoning`) so the cast is
          // semantically safe.
          const direct = map[ctx.tier as CompoundTier];
          if (direct !== undefined) {
            return direct;
          }
          if (fallbackStrategy !== undefined) {
            return createProviderRouter(fallbackStrategy).select(ctx);
          }
          return fallback;
        },
        selectWithMetadata: (ctx) => {
          // Map hit — provenance is plain `tier-routed-compound`.
          const direct = map[ctx.tier as CompoundTier];
          if (direct !== undefined) {
            return {
              provider: direct,
              selected_via: 'tier-routed-compound',
              tier: ctx.tier,
            };
          }
          // fallbackStrategy delegation — provenance is the composition hint
          // `tier-routed-compound:fallback-strategy`; the inner strategy's
          // metadata (dimension / rate_card_source / tier) is preserved so
          // operators can trace WHY the inner strategy picked the provider.
          if (fallbackStrategy !== undefined) {
            const innerRouter = createProviderRouter(fallbackStrategy);
            const innerMeta = innerRouter.selectWithMetadata?.(ctx);
            if (innerMeta !== undefined) {
              return {
                ...innerMeta,
                selected_via: 'tier-routed-compound:fallback-strategy',
              };
            }
            // Inner strategy doesn't expose metadata — fall back to select().
            return {
              provider: innerRouter.select(ctx),
              selected_via: 'tier-routed-compound:fallback-strategy',
              tier: ctx.tier,
            };
          }
          // No map hit, no fallbackStrategy — literal fallback provider.
          return {
            provider: fallback,
            selected_via: 'tier-routed-compound',
            tier: ctx.tier,
          };
        },
      };
    }
  }
}
