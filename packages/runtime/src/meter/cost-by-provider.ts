/**
 * Per-provider cost aggregator per TDD2 §12.3.4 + Plan 05-01 PR-43.
 *
 * Reduces a `MeterSnapshot.records[]` into one row per provider with
 * the cost + token breakdown + share-of-total percentage. The
 * dashboard's `ProviderCostPanel` renders the bars; M5's failover
 * tests (PR-44) assert correct cost attribution when a task spans
 * multiple providers via the fallback chain (PR-42).
 *
 * Formula:
 *   - `cost_usd` — sum of `record.cost_usd` per provider
 *   - `input` / `output` / `cacheRead` / `cacheWrite` — token sums
 *   - `share_pct` — `cost_usd / total_cost * 100`. When total cost is
 *     0 (e.g., free-tier OpenRouter), `share_pct` is split evenly
 *     across the providers present (so the bar chart still renders
 *     meaningfully).
 *
 * Per Principle 4: aggregate-only telemetry; the function reads counts
 * + costs only — no prompt content.
 */

import type { MeterSnapshot } from '@swt-labs/shared';

export interface CostByProvider {
  readonly provider: string;
  readonly cost_usd: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Percentage of total cost in [0, 100]. */
  readonly share_pct: number;
}

/**
 * Aggregate the meter snapshot into per-provider rows sorted by
 * descending `cost_usd` (most expensive first). Returns an empty array
 * when the snapshot has no records.
 */
export function computeCostByProvider(snapshot: MeterSnapshot): ReadonlyArray<CostByProvider> {
  if (snapshot.records.length === 0) return [];

  const byProvider = new Map<
    string,
    { cost_usd: number; input: number; output: number; cacheRead: number; cacheWrite: number }
  >();
  for (const record of snapshot.records) {
    const existing = byProvider.get(record.provider) ?? {
      cost_usd: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    existing.cost_usd += record.cost_usd;
    existing.input += record.input;
    existing.output += record.output;
    existing.cacheRead += record.cacheRead;
    existing.cacheWrite += record.cacheWrite;
    byProvider.set(record.provider, existing);
  }

  const totalCost = snapshot.totals.cost_usd;
  const rowCount = byProvider.size;
  const evenShare = rowCount > 0 ? 100 / rowCount : 0;

  const rows: CostByProvider[] = [];
  for (const [provider, counts] of byProvider) {
    const share_pct = totalCost > 0 ? (counts.cost_usd / totalCost) * 100 : evenShare;
    rows.push({
      provider,
      cost_usd: counts.cost_usd,
      input: counts.input,
      output: counts.output,
      cacheRead: counts.cacheRead,
      cacheWrite: counts.cacheWrite,
      share_pct,
    });
  }
  // Sort: most expensive first; alphabetical tie-break for determinism.
  return rows.sort((a, b) => {
    if (b.cost_usd !== a.cost_usd) return b.cost_usd - a.cost_usd;
    return a.provider.localeCompare(b.provider);
  });
}
