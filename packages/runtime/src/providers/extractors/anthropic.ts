/**
 * Anthropic native usage extractor.
 *
 * Anthropic's `usage` object on a `turn_end` event carries:
 *   - `input_tokens` — fresh prompt tokens (excluding cache reads)
 *   - `output_tokens` — generated tokens
 *   - `cache_read_input_tokens` — tokens served from cache (the v3 cache-control bet)
 *   - `cache_creation_input_tokens` — tokens written to cache (1.25x input rate)
 *
 * Per ADR-004: caching at the provider layer means these numbers are
 * the source of truth for cost calculation; the cache-read multiplier
 * (0.1x input) is applied at the `calculateCost` rate-table layer.
 *
 * alpha.21 — Pi's `withUsageEstimate` helper (faux-provider + non-billable
 * error paths) returns a SECOND shape with camelCase keys:
 *   `{input, output, cacheRead, cacheWrite, totalTokens, cost}`
 * It surfaces on `event.message.usage` interchangeably with the snake_case
 * one, so the extractor accepts both. Per-key precedence is snake_case
 * (real API response) > camelCase (Pi estimate), so a successful API turn
 * keeps reporting authoritative numbers even if Pi pre-populated estimates.
 */

import type { TaskTokenUsage } from '@swt-labs/shared';

interface AnthropicUsageLike {
  // Real Anthropic API response shape (snake_case).
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  // Pi `withUsageEstimate` shape (camelCase). alpha.21 — accepted as a
  // fallback so token accounting stays non-zero through Pi's mock/
  // estimate paths. We deliberately do NOT read `totalTokens` or `cost`
  // (those are derivable + the rate-card is the source of truth for
  // billing — never trust Pi's local cost estimate).
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export function extractAnthropic(
  usage: unknown,
  ctx: { readonly turn: number; readonly provider: string; readonly model: string },
): TaskTokenUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const u = usage as AnthropicUsageLike;
  const inputTokens = u.input_tokens ?? u.input;
  const outputTokens = u.output_tokens ?? u.output;
  const cacheReadTokens = u.cache_read_input_tokens ?? u.cacheRead;
  const cacheWriteTokens = u.cache_creation_input_tokens ?? u.cacheWrite;
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheWriteTokens === undefined
  ) {
    return undefined;
  }
  return {
    input: inputTokens ?? 0,
    output: outputTokens ?? 0,
    cacheRead: cacheReadTokens ?? 0,
    cacheWrite: cacheWriteTokens ?? 0,
    turn: ctx.turn,
    provider: ctx.provider,
    model: ctx.model,
  };
}
