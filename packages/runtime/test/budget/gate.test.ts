/**
 * `createBudgetGate` tests per TDD2 §8.4 + ADR-007 + Plan 04-01 PR-35.
 *
 * The Budget Gate is pure event-driven: spend pressure crossing
 * thresholds fires structured events. These tests pin the state-machine
 * contract:
 *
 *   1. Under-70% pressure → no events fire.
 *   2. Crossing 70% → `budget.warning` fires exactly once.
 *   3. Crossing 95% → `budget.pause` fires exactly once.
 *   4. `bumpCeiling` drops pressure → `budget.resume` fires; state
 *      resets so future crossings can re-fire.
 *   5. Rapid-fire ticks (>100/sec) don't duplicate threshold events.
 *   6. The first observation that already crosses both thresholds in
 *      one tick fires `budget.warning` AND `budget.pause` in order.
 */

import type { BudgetConfigSchemaT, MeterRecord } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { createBudgetGate, type BudgetEvent } from '../../src/budget/gate.js';
import { createTokenMeter } from '../../src/meter/token-meter.js';

const FIXED_CLOCK = (): string => '2026-05-12T10:00:00.000Z';

function defaultConfig(overrides: Partial<BudgetConfigSchemaT> = {}): BudgetConfigSchemaT {
  return {
    schema_version: 1,
    milestone_usd: 100,
    tier_downgrade_threshold: 0.7,
    pause_threshold: 0.95,
    ...overrides,
  };
}

function makeRecord(cost_usd: number, overrides: Partial<MeterRecord> = {}): MeterRecord {
  return {
    timestamp: '2026-05-12T10:00:00.000Z',
    milestone: 'M4',
    phase: '04',
    task_id: 'T-budget-test',
    role: 'dev',
    tier: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    turn: 1,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost_usd,
    ...overrides,
  };
}

describe('createBudgetGate — threshold crossing (M4 PR-35)', () => {
  it('emits no events when pressure stays under the warning threshold', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    // Total spend: $50, pressure 0.5 (under 0.7 warning).
    meter.record(makeRecord(25), 25);
    meter.record(makeRecord(25), 25);

    expect(events).toEqual([]);
    expect(gate.state()).toMatchObject({
      spent_usd: 50,
      ceiling_usd: 100,
      pressure: 0.5,
      status: 'ok',
    });
    gate.dispose();
  });

  it('fires budget.warning exactly once when pressure crosses 70%', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    // 0.65 → no event
    meter.record(makeRecord(65), 65);
    expect(events).toHaveLength(0);

    // 0.75 → warning fires
    meter.record(makeRecord(10), 10);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('budget.warning');
    expect(events[0]?.ts).toBe('2026-05-12T10:00:00.000Z');

    // Another tick still in warning band — no re-emission.
    meter.record(makeRecord(5), 5);
    expect(events).toHaveLength(1);
    expect(gate.state().status).toBe('warning');
    gate.dispose();
  });

  it('fires budget.pause when pressure crosses 95%', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    meter.record(makeRecord(75), 75); // warning
    meter.record(makeRecord(21), 21); // 0.96 → pause
    expect(events.map((e) => e.type)).toEqual(['budget.warning', 'budget.pause']);

    // Subsequent ticks don't re-emit pause.
    meter.record(makeRecord(1), 1);
    expect(events).toHaveLength(2);
    expect(gate.state().status).toBe('paused');
    gate.dispose();
  });

  it('emits warning AND pause in one tick when first observation crosses both', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    // Single tick lands at 0.98 — past both thresholds.
    meter.record(makeRecord(98), 98);
    expect(events.map((e) => e.type)).toEqual(['budget.warning', 'budget.pause']);
    expect(gate.state().status).toBe('paused');
    gate.dispose();
  });

  it('bumpCeiling drops pressure → budget.resume fires; state resets to ok', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    meter.record(makeRecord(96), 96); // warning + pause
    expect(gate.state().status).toBe('paused');

    gate.bumpCeiling(100); // ceiling: 100 → 200; pressure: 0.96 → 0.48
    expect(events.map((e) => e.type)).toEqual(['budget.warning', 'budget.pause', 'budget.resume']);
    expect(gate.state()).toMatchObject({
      status: 'ok',
      ceiling_usd: 200,
      spent_usd: 96,
      pressure: 0.48,
    });

    // A future tick can fire the warning again from the new baseline.
    meter.record(makeRecord(50), 50); // 146 / 200 = 0.73 → warning
    expect(events.map((e) => e.type)).toEqual([
      'budget.warning',
      'budget.pause',
      'budget.resume',
      'budget.warning',
    ]);
    gate.dispose();
  });

  it('bumpCeiling smaller than spend keeps gate in warning state without resume', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    meter.record(makeRecord(96), 96); // pause
    gate.bumpCeiling(20); // ceiling: 100 → 120; pressure: 96/120 = 0.80 → still warning

    expect(events.map((e) => e.type)).toEqual(['budget.warning', 'budget.pause']);
    expect(gate.state().status).toBe('warning');
    expect(gate.state().pressure).toBeCloseTo(0.8);
    gate.dispose();
  });

  it('rapid-fire ticks (100/sec sustained warning) emit exactly one warning event', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    // 100 ticks of $0.71 each — gate enters warning on the first tick.
    for (let i = 0; i < 100; i++) {
      meter.record(makeRecord(0.71), 0.71);
    }
    const warnings = events.filter((e) => e.type === 'budget.warning');
    expect(warnings).toHaveLength(1);
    expect(gate.state().status).toBe('warning');
    gate.dispose();
  });

  it('custom thresholds via config (50% warn / 90% pause) work end-to-end', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({
      config: defaultConfig({ tier_downgrade_threshold: 0.5, pause_threshold: 0.9 }),
      meter,
      clock: FIXED_CLOCK,
    });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    meter.record(makeRecord(40), 40); // 0.4 → no event
    meter.record(makeRecord(15), 15); // 0.55 → warning
    meter.record(makeRecord(40), 40); // 0.95 → pause

    expect(events.map((e) => e.type)).toEqual(['budget.warning', 'budget.pause']);
    gate.dispose();
  });

  it('dispose() unsubscribes from the meter — no further events', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    gate.dispose();
    meter.record(makeRecord(96), 96); // would normally fire warning + pause

    expect(events).toEqual([]);
  });

  it('subscribe() returns an unsubscribe function that removes the listener', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    const unsubscribe = gate.subscribe((e) => events.push(e));

    unsubscribe();
    meter.record(makeRecord(96), 96);
    expect(events).toEqual([]);
    gate.dispose();
  });
});

describe('createBudgetGate — state shape (M4 PR-35)', () => {
  it('reports warning_fired_at + paused_at timestamps on the state object', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });

    expect(gate.state().warning_fired_at).toBeUndefined();
    expect(gate.state().paused_at).toBeUndefined();

    meter.record(makeRecord(96), 96);
    const state = gate.state();
    expect(state.warning_fired_at).toBe('2026-05-12T10:00:00.000Z');
    expect(state.paused_at).toBe('2026-05-12T10:00:00.000Z');
    gate.dispose();
  });

  it('pressure returns 0 when ceiling is 0 (NaN guard)', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({
      config: defaultConfig({ milestone_usd: 0.0001 }), // schema requires positive
      meter,
      clock: FIXED_CLOCK,
    });
    // Drop ceiling to 0 via a negative bump. Pressure should remain
    // finite (0 by definition).
    gate.bumpCeiling(-0.0001);
    expect(gate.state().pressure).toBe(0);
    expect(Number.isNaN(gate.state().pressure)).toBe(false);
    gate.dispose();
  });
});
