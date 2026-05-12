/**
 * Unit tests for the TPAC aggregator (M2 PR-19). Synthetic
 * `MeterSnapshot` fixtures only — no real runtime invocation.
 *
 * Covers:
 *   - The TPAC formula (sum input/output, divide by criteria_satisfied).
 *   - Multi-milestone filtering (records from another milestone excluded).
 *   - Dominant provider/model derivation when not explicitly passed.
 *   - Zero-criteria guard throws `NoSatisfiedCriteriaError`.
 *   - `summariseRoles` per-role aggregation + share calculation.
 *   - Schema validation at emit boundary (Zod parse).
 */

import { TpacReportSchema, type MeterRecord, type MeterSnapshot } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { computeTpac, NoSatisfiedCriteriaError, summariseRoles } from '../src/tpac-meter.js';

function rec(overrides: Partial<MeterRecord> = {}): MeterRecord {
  return {
    timestamp: '2026-05-12T12:00:00.000Z',
    milestone: 'M2',
    phase: '02',
    task_id: 'T-test',
    role: 'dev',
    tier: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    turn: 1,
    input: 1000,
    output: 500,
    cacheRead: 0,
    cacheWrite: 0,
    cost_usd: 0,
    ...overrides,
  };
}

function snapshot(records: MeterRecord[]): MeterSnapshot {
  return {
    totals: records.reduce(
      (acc, r) => ({
        input: acc.input + r.input,
        output: acc.output + r.output,
        cacheRead: acc.cacheRead + r.cacheRead,
        cacheWrite: acc.cacheWrite + r.cacheWrite,
        cost_usd: acc.cost_usd + r.cost_usd,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost_usd: 0 },
    ),
    records,
  };
}

describe('computeTpac', () => {
  it('reduces a single-milestone snapshot to the right totals', () => {
    const snap = snapshot([
      rec({ role: 'scout', input: 800, output: 200 }),
      rec({ role: 'architect', input: 1500, output: 600 }),
      rec({ role: 'lead', input: 700, output: 1200 }),
      rec({ role: 'dev', input: 2000, output: 1500 }),
      rec({ role: 'qa', input: 500, output: 300 }),
    ]);
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 5,
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    expect(report.tpac_input).toBe(5500);
    expect(report.tpac_output).toBe(3800);
    expect(report.tpac_total).toBe(9300);
    expect(report.tokens_per_criterion).toBe(1860);
    expect(report.criteria_satisfied).toBe(5);
    expect(report.provider).toBe('anthropic');
    expect(report.model).toBe('claude-sonnet-4-5-20250929');
    expect(report.fixture).toBe('ref-fastapi-empty');
    expect(report.milestone).toBe('M2');
  });

  it('filters records by milestone — other milestones excluded', () => {
    const snap = snapshot([
      rec({ milestone: 'M2', input: 1000, output: 500 }),
      rec({ milestone: 'M3', input: 9999, output: 9999 }),
      rec({ milestone: 'M2', input: 2000, output: 1000 }),
    ]);
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 1,
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    expect(report.tpac_input).toBe(3000);
    expect(report.tpac_output).toBe(1500);
    expect(report.tpac_total).toBe(4500);
  });

  it('throws NoSatisfiedCriteriaError when criteria_satisfied is 0', () => {
    const snap = snapshot([rec()]);
    expect(() =>
      computeTpac(snap, {
        milestone: 'M2',
        fixture: 'ref-fastapi-empty',
        criteria_satisfied: 0,
      }),
    ).toThrow(NoSatisfiedCriteriaError);
  });

  it('throws when criteria_satisfied is negative', () => {
    const snap = snapshot([rec()]);
    expect(() =>
      computeTpac(snap, {
        milestone: 'M2',
        fixture: 'ref-fastapi-empty',
        criteria_satisfied: -1,
      }),
    ).toThrow(NoSatisfiedCriteriaError);
  });

  it('rounds tokens_per_criterion to 2 decimal places', () => {
    const snap = snapshot([rec({ input: 100, output: 0 })]);
    // 100 / 3 = 33.333... → rounded to 33.33
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 3,
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    expect(report.tokens_per_criterion).toBe(33.33);
  });

  it('derives the dominant provider when not explicitly supplied', () => {
    const snap = snapshot([
      rec({ provider: 'openai', input: 100, output: 100 }),
      rec({ provider: 'anthropic', input: 5000, output: 5000 }),
      rec({ provider: 'anthropic', input: 1000, output: 1000 }),
    ]);
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 1,
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    expect(report.provider).toBe('anthropic');
  });

  it('accepts explicit provider + model overrides', () => {
    const snap = snapshot([rec({ provider: 'anthropic', model: 'irrelevant' })]);
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 1,
      provider: 'openai',
      model: 'gpt-5.5',
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    expect(report.provider).toBe('openai');
    expect(report.model).toBe('gpt-5.5');
  });

  it('omits cost_usd when the sum is zero', () => {
    const snap = snapshot([rec({ cost_usd: 0 })]);
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 1,
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    expect(report.cost_usd).toBeUndefined();
  });

  it('includes cost_usd when records carry non-zero costs', () => {
    const snap = snapshot([rec({ cost_usd: 0.12 }), rec({ cost_usd: 0.34 })]);
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 1,
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    expect(report.cost_usd).toBeCloseTo(0.46, 2);
  });

  it('produces a report that round-trips through TpacReportSchema', () => {
    const snap = snapshot([rec()]);
    const report = computeTpac(snap, {
      milestone: 'M2',
      fixture: 'ref-fastapi-empty',
      criteria_satisfied: 5,
      recordedAt: '2026-05-12T12:00:00.000Z',
    });
    // The aggregator already validates; an extra round-trip parse here
    // confirms the snapshot serialisation stays Zod-clean for the
    // downstream `swt bench` emit consumer (PR-21).
    const reparsed = TpacReportSchema.parse(JSON.parse(JSON.stringify(report)));
    expect(reparsed).toEqual(report);
  });
});

describe('summariseRoles', () => {
  it('returns a per-role breakdown sorted by total descending', () => {
    const snap = snapshot([
      rec({ role: 'scout', input: 100, output: 50 }),
      rec({ role: 'architect', input: 500, output: 200 }),
      rec({ role: 'dev', input: 2000, output: 1000 }),
      rec({ role: 'dev', input: 1500, output: 700 }),
      rec({ role: 'qa', input: 300, output: 200 }),
    ]);
    const summary = summariseRoles(snap, { milestone: 'M2' });
    expect(summary.map((s) => s.role)).toEqual(['dev', 'architect', 'qa', 'scout']);
    const dev = summary[0];
    expect(dev).toBeDefined();
    expect(dev?.input).toBe(3500);
    expect(dev?.output).toBe(1700);
    expect(dev?.total).toBe(5200);
    expect(dev?.turns).toBe(2);
  });

  it('computes per-role share correctly', () => {
    const snap = snapshot([
      rec({ role: 'dev', input: 7000, output: 3000 }), // 10000
      rec({ role: 'qa', input: 3000, output: 2000 }), // 5000
    ]);
    const summary = summariseRoles(snap, { milestone: 'M2' });
    const dev = summary.find((s) => s.role === 'dev');
    const qa = summary.find((s) => s.role === 'qa');
    expect(dev?.share).toBeCloseTo(10000 / 15000, 4);
    expect(qa?.share).toBeCloseTo(5000 / 15000, 4);
  });

  it('lowercases role keys for stable comparison', () => {
    const snap = snapshot([
      rec({ role: 'Dev', input: 100, output: 100 }),
      rec({ role: 'DEV', input: 200, output: 200 }),
    ]);
    const summary = summariseRoles(snap, { milestone: 'M2' });
    expect(summary).toHaveLength(1);
    expect(summary[0]?.role).toBe('dev');
    expect(summary[0]?.turns).toBe(2);
  });

  it('returns empty array when no records match the milestone filter', () => {
    const snap = snapshot([rec({ milestone: 'M3' })]);
    const summary = summariseRoles(snap, { milestone: 'M2' });
    expect(summary).toEqual([]);
  });
});
