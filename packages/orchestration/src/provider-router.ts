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

import type { TaskBrief } from '@swt-labs/shared';

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
  }
}
