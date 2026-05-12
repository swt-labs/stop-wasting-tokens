/**
 * `computeCostByProvider` unit tests per Plan 05-01 PR-43.
 */

import type { MeterRecord, MeterSnapshot } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { computeCostByProvider } from '../../src/meter/cost-by-provider.js';

function record(overrides: Partial<MeterRecord>): MeterRecord {
  return {
    timestamp: '2026-05-12T10:00:00.000Z',
    milestone: 'M5',
    phase: '05',
    task_id: 'T-cost-test',
    role: 'dev',
    tier: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
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

describe('computeCostByProvider (M5 PR-43)', () => {
  it('returns an empty array for an empty snapshot', () => {
    expect(computeCostByProvider(snapshot([]))).toEqual([]);
  });

  it('aggregates cost + tokens per provider', () => {
    const result = computeCostByProvider(
      snapshot([
        record({ provider: 'anthropic', cost_usd: 1.5, input: 100, output: 50 }),
        record({ provider: 'anthropic', cost_usd: 2.5, input: 200, output: 100, cacheRead: 500 }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      provider: 'anthropic',
      cost_usd: 4.0,
      input: 300,
      output: 150,
      cacheRead: 500,
      cacheWrite: 0,
      share_pct: 100,
    });
  });

  it('partitions per provider with correct share_pct computation', () => {
    const result = computeCostByProvider(
      snapshot([
        record({ provider: 'anthropic', cost_usd: 7.5 }),
        record({ provider: 'openai', cost_usd: 2.5 }),
      ]),
    );
    expect(result).toHaveLength(2);
    const anthropic = result.find((r) => r.provider === 'anthropic');
    const openai = result.find((r) => r.provider === 'openai');
    expect(anthropic?.cost_usd).toBe(7.5);
    expect(anthropic?.share_pct).toBeCloseTo(75);
    expect(openai?.cost_usd).toBe(2.5);
    expect(openai?.share_pct).toBeCloseTo(25);
  });

  it('orders rows by descending cost_usd (most expensive first)', () => {
    const result = computeCostByProvider(
      snapshot([
        record({ provider: 'cheap', cost_usd: 0.5 }),
        record({ provider: 'medium', cost_usd: 5.0 }),
        record({ provider: 'expensive', cost_usd: 10.0 }),
      ]),
    );
    expect(result.map((r) => r.provider)).toEqual(['expensive', 'medium', 'cheap']);
  });

  it('breaks ties alphabetically for deterministic ordering', () => {
    const result = computeCostByProvider(
      snapshot([
        record({ provider: 'zebra', cost_usd: 5.0 }),
        record({ provider: 'alpha', cost_usd: 5.0 }),
        record({ provider: 'beta', cost_usd: 5.0 }),
      ]),
    );
    expect(result.map((r) => r.provider)).toEqual(['alpha', 'beta', 'zebra']);
  });

  it('splits share_pct evenly when total cost is 0 (free-tier providers)', () => {
    const result = computeCostByProvider(
      snapshot([
        record({ provider: 'openrouter-free', cost_usd: 0, input: 100 }),
        record({ provider: 'ollama', cost_usd: 0, input: 200 }),
      ]),
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.share_pct).toBeCloseTo(50);
    expect(result[1]?.share_pct).toBeCloseTo(50);
  });

  it('aggregates all four token buckets independently', () => {
    const result = computeCostByProvider(
      snapshot([
        record({
          provider: 'anthropic',
          cost_usd: 1.0,
          input: 100,
          output: 50,
          cacheRead: 800,
          cacheWrite: 25,
        }),
        record({
          provider: 'anthropic',
          cost_usd: 0.5,
          input: 50,
          output: 25,
          cacheRead: 400,
          cacheWrite: 10,
        }),
      ]),
    );
    expect(result[0]).toMatchObject({
      input: 150,
      output: 75,
      cacheRead: 1200,
      cacheWrite: 35,
    });
  });
});
