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

export type Tier = 'cheap-fast' | 'balanced' | 'quality' | 'reasoning';

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
    };

export interface ProviderRouter {
  /** Returns the provider id selected for the supplied context. */
  select(ctx: RouterSelectionContext): string;
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
      return { select: () => pinned };
    }
    case 'round-robin': {
      if (strategy.providers.length === 0) {
        throw new Error("createProviderRouter: 'round-robin' requires a non-empty providers list.");
      }
      const providers = strategy.providers;
      let internal = 0;
      const counter = strategy.counter ?? ((): number => internal++);
      return {
        select: () => {
          const i = counter();
          // Modulo guards negative counters (theoretical only).
          const idx = ((i % providers.length) + providers.length) % providers.length;
          return providers[idx] as string;
        },
      };
    }
    case 'tier-routed': {
      const map = strategy.map;
      const fallback = strategy.fallback;
      return {
        select: (ctx) => map[ctx.tier] ?? fallback,
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
      return {
        select: () => {
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
        },
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
      return {
        select: () => {
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
        },
      };
    }
  }
}
