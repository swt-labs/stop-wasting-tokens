/**
 * Cache-hit ratio aggregator per TDD2 §12.3.2 + Plan 04-01 PR-33.
 *
 * The Anthropic + OpenAI extractors (PR-07/PR-08) route per-turn token
 * usage into the meter's four buckets:
 *   - `input` — fresh prompt tokens
 *   - `output` — generated tokens
 *   - `cacheRead` — tokens served from cache (Anthropic explicit via
 *                  `cache_control`, OpenAI implicit via auto-cache)
 *   - `cacheWrite` — tokens written to cache (Anthropic's cache-creation
 *                   path; OpenAI auto-cache has no separate write metric)
 *
 * The M4 EXIT GATE asserts cache hit ratio ≥ 70% on Anthropic runs of
 * the reference project. This module computes the ratio per provider
 * from any `MeterSnapshot`:
 *
 *   ratio = cacheRead / (cacheRead + cacheWrite + input)
 *
 * Denominator = "everything sent on the wire that COULD have been
 * cached". Excludes `output` (generated tokens are never cached input).
 * Returns 0 when the denominator is zero (no usage recorded for the
 * provider) — protect against NaN downstream.
 *
 * Per Principle 4: cache-hit ratio is aggregate-only telemetry. No
 * prompt content here; this module only reads counts.
 */

import type { MeterSnapshot } from '@swt-labs/shared';

export interface CacheHitSummary {
  /** Provider id (e.g., `'anthropic'`, `'openai'`, `'openrouter'`). */
  readonly provider: string;
  /** Aggregate cacheRead tokens across every record for this provider. */
  readonly cacheRead: number;
  /** Aggregate cacheWrite tokens. Anthropic-only in practice today. */
  readonly cacheWrite: number;
  /** Aggregate fresh `input` tokens (cache misses + first-turn prompts). */
  readonly input: number;
  /**
   * Cache hit ratio in [0, 1]. Zero when the provider has no recorded
   * usage. The M4 exit-gate target is ≥ 0.70 on Anthropic runs.
   */
  readonly ratio: number;
}

/**
 * Aggregate cache-hit metrics from a `MeterSnapshot` by provider.
 * Returns one summary per distinct `provider` value seen in the
 * snapshot's records, sorted alphabetically for deterministic display.
 */
export function computeCacheHitRatio(snapshot: MeterSnapshot): ReadonlyArray<CacheHitSummary> {
  const byProvider = new Map<string, { cacheRead: number; cacheWrite: number; input: number }>();
  for (const record of snapshot.records) {
    const existing = byProvider.get(record.provider) ?? {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
    };
    existing.cacheRead += record.cacheRead;
    existing.cacheWrite += record.cacheWrite;
    existing.input += record.input;
    byProvider.set(record.provider, existing);
  }

  const summaries: CacheHitSummary[] = [];
  for (const [provider, counts] of byProvider) {
    summaries.push({
      provider,
      cacheRead: counts.cacheRead,
      cacheWrite: counts.cacheWrite,
      input: counts.input,
      ratio: ratioFromCounts(counts),
    });
  }
  return summaries.sort((a, b) => a.provider.localeCompare(b.provider));
}

/**
 * Pure helper: compute the ratio from a single counts triple.
 * Exposed for sites (dashboard panel, regression assertions) that
 * want to apply the same formula without rebuilding the full
 * provider-aggregation pass.
 */
export function ratioFromCounts(counts: {
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly input: number;
}): number {
  const denominator = counts.cacheRead + counts.cacheWrite + counts.input;
  if (denominator <= 0) return 0;
  return counts.cacheRead / denominator;
}
