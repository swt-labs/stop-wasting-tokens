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
 */

import type { TaskTokenUsage } from '@swt-labs/shared';

interface AnthropicUsageLike {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

export function extractAnthropic(
  usage: unknown,
  ctx: { readonly turn: number; readonly provider: string; readonly model: string },
): TaskTokenUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const u = usage as AnthropicUsageLike;
  if (
    u.input_tokens === undefined &&
    u.output_tokens === undefined &&
    u.cache_read_input_tokens === undefined &&
    u.cache_creation_input_tokens === undefined
  ) {
    return undefined;
  }
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    turn: ctx.turn,
    provider: ctx.provider,
    model: ctx.model,
  };
}
