import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTokenMeter,
  groupRecordsByDimension,
} from '../../src/meter/token-meter.js';
import type { MeterRecord, MeterUpdate } from '@swt-labs/shared';

function baseRecord(overrides: Partial<Omit<MeterRecord, 'cost_usd'>> = {}): Omit<
  MeterRecord,
  'cost_usd'
> {
  return {
    timestamp: '2026-05-11T00:00:00Z',
    milestone: 'm1',
    phase: 'p1',
    task_id: 't1',
    role: 'dev',
    tier: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    turn: 1,
    input: 100,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    ...overrides,
  };
}

describe('@swt-labs/runtime — createTokenMeter', () => {
  it('records a single row and exposes totals in snapshot()', () => {
    const meter = createTokenMeter();
    meter.record(baseRecord(), 0.0015);
    const snap = meter.snapshot();
    expect(snap.totals.input).toBe(100);
    expect(snap.totals.output).toBe(50);
    expect(snap.totals.cost_usd).toBe(0.0015);
    expect(snap.records).toHaveLength(1);
  });

  it('aggregates across multiple turns within one task', () => {
    const meter = createTokenMeter();
    meter.record(baseRecord({ turn: 1, input: 100, output: 50 }), 0.001);
    meter.record(baseRecord({ turn: 2, input: 200, output: 80, cacheRead: 30 }), 0.002);
    meter.record(baseRecord({ turn: 3, input: 50, output: 30, cacheWrite: 10 }), 0.0005);
    const snap = meter.snapshot();
    expect(snap.totals.input).toBe(350);
    expect(snap.totals.output).toBe(160);
    expect(snap.totals.cacheRead).toBe(30);
    expect(snap.totals.cacheWrite).toBe(10);
    expect(snap.totals.cost_usd).toBeCloseTo(0.0035, 10);
    expect(snap.records).toHaveLength(3);
  });

  it('subscribe receives METER_UPDATED on each record()', () => {
    const meter = createTokenMeter();
    const events: MeterUpdate[] = [];
    const unsubscribe = meter.subscribe((e) => events.push(e));
    meter.record(baseRecord({ turn: 1 }), 0.001);
    meter.record(baseRecord({ turn: 2 }), 0.002);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('METER_UPDATED');
    expect(events[0]?.record.turn).toBe(1);
    expect(events[1]?.record.turn).toBe(2);
    unsubscribe();
    meter.record(baseRecord({ turn: 3 }), 0.003);
    expect(events).toHaveLength(2);
  });

  it('unsubscribe during dispatch does not break iteration', () => {
    const meter = createTokenMeter();
    const events: number[] = [];
    let unsubA: (() => void) | undefined;
    const unsubB = meter.subscribe((e) => events.push(2 * 100 + e.record.turn));
    unsubA = meter.subscribe((e) => {
      events.push(1 * 100 + e.record.turn);
      unsubA?.();
    });
    void unsubB;
    meter.record(baseRecord({ turn: 7 }), 0);
    // Both listeners fire on the first record despite A unsubscribing itself.
    expect(events).toContain(107);
    expect(events).toContain(207);
    meter.record(baseRecord({ turn: 8 }), 0);
    // A is now unsubscribed; only B fires.
    expect(events.filter((v) => v === 108)).toHaveLength(0);
    expect(events.filter((v) => v === 208)).toHaveLength(1);
  });

  it('snapshot.records is a copy — mutations to it do not affect future snapshots', () => {
    const meter = createTokenMeter();
    meter.record(baseRecord({ turn: 1 }), 0);
    const snap1 = meter.snapshot();
    (snap1.records as MeterRecord[]).push({} as MeterRecord);
    const snap2 = meter.snapshot();
    expect(snap2.records).toHaveLength(1);
  });

  describe('groupRecordsByDimension', () => {
    it('groups by phase', () => {
      const meter = createTokenMeter();
      meter.record(baseRecord({ phase: 'p1', turn: 1 }), 0);
      meter.record(baseRecord({ phase: 'p1', turn: 2 }), 0);
      meter.record(baseRecord({ phase: 'p2', turn: 1 }), 0);
      const grouped = groupRecordsByDimension(meter.snapshot(), 'phase');
      expect(grouped.get('p1')).toHaveLength(2);
      expect(grouped.get('p2')).toHaveLength(1);
    });

    it('groups by provider', () => {
      const meter = createTokenMeter();
      meter.record(baseRecord({ provider: 'anthropic' }), 0);
      meter.record(baseRecord({ provider: 'openai' }), 0);
      meter.record(baseRecord({ provider: 'openai' }), 0);
      const grouped = groupRecordsByDimension(meter.snapshot(), 'provider');
      expect(grouped.get('anthropic')).toHaveLength(1);
      expect(grouped.get('openai')).toHaveLength(2);
    });
  });

  describe('persistence', () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'swt-meter-test-'));
    });
    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('persist=true writes one JSONL row per record', () => {
      const persistPath = join(tmpDir, 'subdir', 'records.jsonl');
      const meter = createTokenMeter({ persist: true, persistPath });
      meter.record(baseRecord({ turn: 1, input: 11 }), 0.1);
      meter.record(baseRecord({ turn: 2, input: 22 }), 0.2);
      const content = readFileSync(persistPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      const r1 = JSON.parse(lines[0] ?? '{}');
      const r2 = JSON.parse(lines[1] ?? '{}');
      expect(r1.turn).toBe(1);
      expect(r1.input).toBe(11);
      expect(r1.cost_usd).toBe(0.1);
      expect(r2.turn).toBe(2);
    });

    it('persist=true without persistPath throws', () => {
      const meter = createTokenMeter({ persist: true });
      expect(() => meter.record(baseRecord(), 0)).toThrow(/persistPath/);
    });
  });
});
