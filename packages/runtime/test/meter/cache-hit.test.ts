/**
 * `computeCacheHitRatio` unit tests per Plan 04-01 PR-33.
 *
 * The function is a pure aggregator over `MeterSnapshot.records`.
 * Tests cover:
 *   1. Per-provider aggregation (multiple records for one provider sum).
 *   2. Multi-provider partitioning (Anthropic + OpenAI summed separately).
 *   3. Ratio formula = cacheRead / (cacheRead + cacheWrite + input).
 *   4. Zero-denominator returns 0 (no NaN).
 *   5. Empty snapshot returns empty array.
 *   6. Deterministic alphabetical ordering by provider.
 *   7. `ratioFromCounts` exported helper produces identical results.
 */

import type { MeterRecord, MeterSnapshot } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { computeCacheHitRatio, ratioFromCounts } from '../../src/meter/cache-hit.js';

function record(overrides: Partial<MeterRecord>): MeterRecord {
  return {
    timestamp: '2026-05-12T10:00:00.000Z',
    milestone: 'M4',
    phase: '04',
    task_id: 'T-cache-hit-test',
    role: 'dev',
    tier: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    turn: 1,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost_usd: 0,
    ...overrides,
  };
}

function snapshot(records: readonly MeterRecord[]): MeterSnapshot {
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost_usd: 0,
  };
  for (const r of records) {
    totals.input += r.input;
    totals.output += r.output;
    totals.cacheRead += r.cacheRead;
    totals.cacheWrite += r.cacheWrite;
    totals.cost_usd += r.cost_usd;
  }
  return { totals, records };
}

describe('computeCacheHitRatio (M4 PR-33)', () => {
  it('aggregates multiple records for one provider', () => {
    const result = computeCacheHitRatio(
      snapshot([
        record({ provider: 'anthropic', cacheRead: 100, cacheWrite: 20, input: 30 }),
        record({ provider: 'anthropic', cacheRead: 200, cacheWrite: 0, input: 50 }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      provider: 'anthropic',
      cacheRead: 300,
      cacheWrite: 20,
      input: 80,
      ratio: 300 / (300 + 20 + 80),
    });
  });

  it('partitions per provider with independent aggregation', () => {
    const result = computeCacheHitRatio(
      snapshot([
        record({ provider: 'anthropic', cacheRead: 500, input: 100 }),
        record({ provider: 'openai', cacheRead: 300, input: 200 }),
        record({ provider: 'anthropic', cacheRead: 100, cacheWrite: 50 }),
      ]),
    );
    expect(result).toHaveLength(2);
    const byProvider = new Map(result.map((s) => [s.provider, s]));
    expect(byProvider.get('anthropic')).toMatchObject({
      cacheRead: 600,
      cacheWrite: 50,
      input: 100,
      ratio: 600 / (600 + 50 + 100),
    });
    expect(byProvider.get('openai')).toMatchObject({
      cacheRead: 300,
      cacheWrite: 0,
      input: 200,
      ratio: 300 / (300 + 0 + 200),
    });
  });

  it('ratio excludes output tokens from the denominator', () => {
    // 1000 output tokens shouldn't affect ratio.
    const result = computeCacheHitRatio(
      snapshot([record({ provider: 'anthropic', cacheRead: 100, input: 100, output: 1000 })]),
    );
    expect(result[0]?.ratio).toBeCloseTo(0.5);
  });

  it('returns ratio = 0 for zero-denominator (no NaN)', () => {
    const result = computeCacheHitRatio(
      snapshot([record({ provider: 'anthropic', cacheRead: 0, cacheWrite: 0, input: 0 })]),
    );
    expect(result[0]?.ratio).toBe(0);
    expect(Number.isNaN(result[0]?.ratio ?? NaN)).toBe(false);
  });

  it('returns empty array for an empty snapshot', () => {
    const result = computeCacheHitRatio(snapshot([]));
    expect(result).toEqual([]);
  });

  it('orders results alphabetically by provider', () => {
    const result = computeCacheHitRatio(
      snapshot([
        record({ provider: 'openrouter', cacheRead: 1 }),
        record({ provider: 'anthropic', cacheRead: 1 }),
        record({ provider: 'openai', cacheRead: 1 }),
      ]),
    );
    expect(result.map((s) => s.provider)).toEqual(['anthropic', 'openai', 'openrouter']);
  });

  it('M4 EXIT GATE target: ratio ≥ 0.70 on a high-cache-hit run is detectable', () => {
    // 8000 cache reads + 1500 input + 500 cache writes => 8000/10000 = 0.80
    const result = computeCacheHitRatio(
      snapshot([record({ provider: 'anthropic', cacheRead: 8000, input: 1500, cacheWrite: 500 })]),
    );
    expect(result[0]?.ratio).toBeCloseTo(0.8);
    expect(result[0]?.ratio).toBeGreaterThanOrEqual(0.7);
  });
});

describe('ratioFromCounts (M4 PR-33)', () => {
  it('produces identical results to computeCacheHitRatio for a single triple', () => {
    const counts = { cacheRead: 700, cacheWrite: 100, input: 200 };
    expect(ratioFromCounts(counts)).toBe(700 / 1000);
  });

  it('returns 0 on zero denominator', () => {
    expect(ratioFromCounts({ cacheRead: 0, cacheWrite: 0, input: 0 })).toBe(0);
  });
});
