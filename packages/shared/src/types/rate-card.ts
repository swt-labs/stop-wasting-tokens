/**
 * Phase 2 / G-R3 — Rate-card type + entry schemas.
 *
 * Vendor-neutral price snapshot consumed by:
 *
 *   - `@swt-labs/orchestration` plan 02-02 — the `cost-optimized-rate-card`
 *     provider-router strategy reads `RateCardEntry.input_per_1k` /
 *     `output_per_1k` (and optionally cache fields) to pick the cheapest
 *     provider for a given dimension.
 *   - `@swt-labs/runtime` plan 02-01 (this plan) — `createRateCardSource` in
 *     `packages/runtime/src/budget/rate-card-source.ts` loads + validates a
 *     `RateCard` from disk (embedded snapshot or project override).
 *
 * Schema-only module: NO file IO, NO `fs`/`path` imports. The loader (in
 * `@swt-labs/runtime`) owns IO; this module is the leaf shape that both
 * orchestration and runtime depend on without inverting the package graph
 * (orchestration is BELOW runtime per the dependency rules in CLAUDE.md +
 * `packages/shared/src/index.ts` doc comment).
 *
 * Units: USD per 1,000 tokens (per-1k). Cassette token deltas (per
 * `CookUsageSchema` at `packages/shared/src/schemas/events.ts:161-167`) are
 * emitted in *raw token counts*, so per-1k is the natural multiplier
 * (`tokens / 1000 * input_per_1k`). The legacy `cost-optimized` strategy's
 * inline `priceTable` at `packages/orchestration/src/provider-router.ts:104-127`
 * documented "USD per million tokens, or any normalized unit"; Phase 2
 * normalizes to per-1k explicitly so the unit cannot drift between callsites.
 */

import { z } from 'zod';

/**
 * One row of a rate card: per-model per-token pricing in USD per 1,000 tokens.
 *
 * Cache pricing fields are OPTIONAL because only Anthropic publishes a
 * distinct prompt-cache rate today; OpenAI / OpenRouter / Google bill cache
 * reads at the regular input rate. Authors omit these fields for providers
 * without distinct cache pricing.
 *
 * `updated_at` is per-entry (not per-card) because vendors revise pricing on
 * different cadences. The card's `generated_at` is when the snapshot as a
 * whole was assembled; `updated_at` per-entry is when that specific model's
 * pricing was last verified against the upstream source.
 */
export const RateCardEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  input_per_1k: z.number().nonnegative(),
  output_per_1k: z.number().nonnegative(),
  cache_read_per_1k: z.number().nonnegative().optional(),
  cache_write_per_1k: z.number().nonnegative().optional(),
  updated_at: z.string().datetime({ offset: true }),
});

/**
 * The full rate card: a schema-versioned snapshot of one or more entries.
 *
 * `schema_version` is a fixed-integer literal so Zod can refuse future-shape
 * cards loudly. When a v2 schema lands, the loader can dispatch on the literal
 * without false-matching a v1 reader against a v2 file.
 *
 * `source` distinguishes the card's origin so telemetry (plan 02-04) can
 * surface staleness + provenance per spawn:
 *
 *   - `'embedded'`     — ships in the npm tarball (default fallback).
 *   - `'project-override'` — loaded from `<cwd>/.swt-planning/rate-card.json`
 *     or an explicit `opts.path` override.
 *   - `'fetched'`      — reserved for the future live-fetch path; NOT used
 *     in Phase 2 (R1 decision (c) deferred).
 */
export const RateCardSchema = z.object({
  schema_version: z.literal(1),
  source: z.enum(['embedded', 'project-override', 'fetched']),
  generated_at: z.string().datetime({ offset: true }),
  entries: z.array(RateCardEntrySchema).min(1),
});

export type RateCardEntry = z.infer<typeof RateCardEntrySchema>;
export type RateCard = z.infer<typeof RateCardSchema>;
