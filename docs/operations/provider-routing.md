# Provider Routing — Strategy Reference (Phase 2 / G-R3)

This guide documents the 6 provider-router strategies SWT ships, the CompoundTier vocabulary, and the bounded recursion model for compound strategies.

Source of truth: `packages/orchestration/src/provider-router.ts` (`RouterStrategy` discriminated union + `createProviderRouter` factory) and `packages/cli/src/commands/cook.ts` (`CookProviderStrategy` config-facing shape + `toRouterStrategy` mapper).

## Overview

`runSpawnWithFallback` (at `packages/cli/src/commands/cook.ts:2006`) constructs a router from `opts.providers.strategy` and calls `router.select({task, tier})` ONCE per spawn to pick the primary provider. The fallback chain (separate from the router; see `packages/orchestration/src/provider-fallback.ts`) handles retry-on-failure independently.

## Strategy reference

### 1. `pinned`

```jsonc
{ "kind": "pinned", "provider": "anthropic" }
```

Returns the literal `provider` for every spawn; tier is ignored. The default for `DEFAULT_PROVIDERS_CONFIG`.

### 2. `round-robin`

```jsonc
{ "kind": "round-robin", "providers": ["anthropic", "openai", "openrouter"] }
```

Cycles through `providers` modulo `providers.length`; tier is ignored. Throws on empty list.

### 3. `tier-routed` (legacy 4-element)

```jsonc
{
  "kind": "tier-routed",
  "map": { "cheap-fast": "openrouter", "balanced": "anthropic" },
  "fallback": "anthropic",
}
```

Flat dictionary lookup `map[ctx.tier] ?? fallback`. Tier vocabulary: `'cheap-fast' | 'balanced' | 'quality' | 'reasoning'` (the original 4-element `Tier` enum). Preserved verbatim for Phase 6 compat.

### 4. `cost-optimized` (legacy literal price table)

```jsonc
{
  "kind": "cost-optimized",
  "providers": ["anthropic", "openai", "openrouter"],
  "priceTable": { "anthropic": 15.0, "openai": 10.0, "openrouter": 0.5 },
}
```

Picks the cheapest provider from `priceTable`. Operators paste current per-million-token (or per-1k, or any normalized) values into the literal table. Preserved for backwards compat; new deployments should prefer `cost-optimized-rate-card`.

### 5. `cost-optimized-rate-card` (new — Phase 2 / G-R3)

```jsonc
{
  "kind": "cost-optimized-rate-card",
  "providers": ["anthropic", "openai", "openrouter"],
  "rateCard": {
    /* loaded via @swt-labs/runtime's createRateCardSource */
  },
  "dimension": "input",
  "model": "claude-opus-4-7",
}
```

Picks the cheapest provider from `providers` by looking up per-1k pricing in a schema-validated `RateCard` (see `packages/shared/src/types/rate-card.ts`). Missing entries → `Infinity` (excluded). The `dimension` field selects `'input'`, `'output'`, or `'blended'` (average). Optional `model` pins lookup to a specific (provider, model) pair.

Cook callers populate `rateCard` by calling `createRateCardSource({cwd}).readCurrent()` (from `@swt-labs/runtime`) before handing the strategy to `runSpawnWithFallback`.

### 6. `tier-routed-compound` (new — Phase 2 / G-R3)

```jsonc
{
  "kind": "tier-routed-compound",
  "map": {
    "cheap-fast": "openrouter",
    "standard-standard": "anthropic",
    "premium-slow": "anthropic",
  },
  "fallback": "anthropic",
  "fallbackStrategy": {
    "kind": "cost-optimized-rate-card",
    "providers": ["anthropic", "openrouter"],
    "rateCard": {
      /* ... */
    },
    "dimension": "blended",
  },
}
```

Richer tier vocabulary on top of `tier-routed`. Resolution order:

1. `map[ctx.tier]` — return the mapped provider if present.
2. `fallbackStrategy.select(ctx)` — delegate if supplied (R3 bounded depth-1).
3. `fallback` — return the literal fallback provider id.

## CompoundTier vocabulary

Cost axis: `cheap`, `standard`, `premium`. Speed axis: `fast`, `standard`, `slow`. Model-class hint (axis-orthogonal): `reasoning`.

| Tier                      | Cost     | Speed    | Notes                                                                                            |
| ------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `cheap-fast`              | cheap    | fast     | Latency-optimised low-cost models (e.g., gpt-5-mini, gemini-flash). Also a legacy Phase 6 alias. |
| `cheap-standard`          | cheap    | standard | Standard-latency low-cost models.                                                                |
| `standard-fast`           | standard | fast     | Default-quality, latency-optimised models.                                                       |
| `standard-standard`       | standard | standard | Default everything. Alias for legacy `balanced`.                                                 |
| `standard-slow`           | standard | slow     | Default-quality, deep reasoning (extended thinking). Alias for legacy `quality`.                 |
| `premium-standard`        | premium  | standard | Top-tier models, default latency.                                                                |
| `premium-slow`            | premium  | slow     | Top-tier models, deep reasoning.                                                                 |
| `reasoning`               | n/a      | n/a      | Model-class hint — extended thinking / o-series; orthogonal to cost/speed. Also a legacy alias.  |
| `balanced` (legacy alias) | standard | standard | Maps onto `standard-standard`. Preserved for Phase 6 configs.                                    |
| `quality` (legacy alias)  | standard | slow     | Maps onto `standard-slow`. Preserved for Phase 6 configs.                                        |

Final unique vocabulary: 10 strings (7 compound + 1 model-class hint + 2 legacy aliases not already in the compound grid).

**Excluded from the grid:**

- `premium-fast` — no model is both top-tier AND latency-optimised today. Can be added if Anthropic / OpenAI ship a premium-fast SKU.
- `cheap-slow` — cheap models are inherently fast; no use case.

## Migration: `tier-routed` → `tier-routed-compound`

Existing `.swt-planning/config.json` files using `tier-routed` continue to work unchanged. To opt into the wider vocabulary:

1. Change `kind` from `"tier-routed"` to `"tier-routed-compound"`.
2. Optionally add compound tier keys to the `map` (e.g., `"premium-slow"`, `"standard-fast"`).
3. Optionally add `"fallbackStrategy"` for richer per-miss behavior.
4. No config `schema_version` bump required (additive change; see plan 02-02 R4 decision).

Unknown map keys are silently dropped at `toRouterStrategy` mapping time — typos surface as fallbacks rather than hard errors. This mirrors the legacy `tier-routed` filter behaviour (cook.ts validTiers / validCompoundTiers).

## R3 — Bounded depth-1 recursion

The router-layer type for `tier-routed-compound`'s `fallbackStrategy` is `Exclude<RouterStrategy, {kind:'tier-routed-compound'}>`. This means:

- `fallbackStrategy` can be `pinned`, `round-robin`, `tier-routed`, `cost-optimized`, or `cost-optimized-rate-card`.
- `fallbackStrategy` CANNOT itself be `tier-routed-compound`.

Operators express composition declaratively: "tier-routed-compound for the tiers I care about; cost-optimized-rate-card for the rest." Nested depth is intentionally bounded — Phase 2 ships depth-1; Phase 3+ can lift the restriction if needed.

The cook config layer (`CookProviderStrategy.fallbackStrategy: CookProviderStrategy`) is recursively typed (open recursion at the config boundary); the router-layer `Exclude<...>` bound catches nested `tier-routed-compound` at the `toRouterStrategy` mapping boundary.

## Cross-references

- Source of truth (orchestration): `packages/orchestration/src/provider-router.ts`
- Cook config surface: `packages/cli/src/commands/cook.ts:CookProviderStrategy` (plan 02-02 + plan 02-03 extensions)
- Rate-card schema: `packages/shared/src/types/rate-card.ts` (plan 02-01)
- Rate-card loader: `packages/runtime/src/budget/rate-card-source.ts` (plan 02-01)
- Refresh script: `scripts/refresh-rate-card.mjs` + `docs/operations/rate-card-refresh.md`
- Phase research: `.vbw-planning/phases/02-provider-router-strategy-extensions/02-RESEARCH.md`
