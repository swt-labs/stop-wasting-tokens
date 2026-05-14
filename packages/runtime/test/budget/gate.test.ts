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

import type { CostProjection } from '../../src/budget/cost-projector.js';
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

/**
 * Build a `CostProjection` fixture (plan 03-01 shape). `projected_cost_usd`
 * is the worst-case gating number `BudgetGate.project()` reads; the other
 * fields ride along for the event payload but never drive `would_exceed`.
 */
function makeProjection(
  projected_cost_usd: number,
  overrides: Partial<CostProjection> = {},
): CostProjection {
  return {
    projected_cost_usd,
    expected_cost_usd: projected_cost_usd / 2,
    projected_input_tokens: 1000,
    projected_output_tokens: 2000,
    confidence: 'medium',
    assumptions: ['input estimated via char/4 heuristic'],
    rate_card_source: 'embedded',
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

describe('createBudgetGate — project() pre-spawn projection (Phase 3 / 03-03, G-R4)', () => {
  it('is a pure read — never mutates state or fires events across many calls', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });
    const events: BudgetEvent[] = [];
    gate.subscribe((e) => events.push(e));

    // Drive `spent` to a non-trivial baseline so the snapshot is meaningful.
    meter.record(makeRecord(40), 40);
    const snapshot = structuredClone(gate.state());

    // Call project() repeatedly with widely varying projections — including
    // one that would blow the ceiling.
    gate.project(makeProjection(5));
    gate.project(makeProjection(100));
    gate.project(makeProjection(0));
    gate.project(makeProjection(9999));

    // State is byte-identical and no BudgetEvent fired from project().
    expect(gate.state()).toEqual(snapshot);
    expect(events).toEqual([]);
    gate.dispose();
  });

  it('would_exceed reflects the projection_halt_threshold ?? pause_threshold cutoff', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });

    // spent = 90 / ceiling 100 → pressure 0.90 (under pause_threshold 0.95).
    meter.record(makeRecord(90), 90);

    // +6 → projected_pressure 0.96 ≥ 0.95 → would_exceed.
    const over = gate.project(makeProjection(6));
    expect(over.projected_pressure).toBeCloseTo(0.96);
    expect(over.would_exceed).toBe(true);

    // +2 → projected_pressure 0.92 < 0.95 → stays under.
    const under = gate.project(makeProjection(2));
    expect(under.projected_pressure).toBeCloseTo(0.92);
    expect(under.would_exceed).toBe(false);
    gate.dispose();
  });

  it('projection_halt_threshold overrides pause_threshold with a stricter cutoff', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({
      config: defaultConfig({ pause_threshold: 0.95, projection_halt_threshold: 0.8 }),
      meter,
      clock: FIXED_CLOCK,
    });

    // spent = 70 / ceiling 100 → pressure 0.70. +15 → projected_pressure
    // 0.85: BETWEEN the stricter 0.80 cutoff and the looser 0.95 one.
    meter.record(makeRecord(70), 70);
    const result = gate.project(makeProjection(15));
    expect(result.projected_pressure).toBeCloseTo(0.85);
    // would_exceed under the 0.80 projection cutoff (would be false at 0.95).
    expect(result.would_exceed).toBe(true);
    gate.dispose();
  });

  it('task_usd cap makes would_exceed true on the per-spawn ceiling alone', () => {
    // task_usd set — a projection over the per-spawn cap halts even though
    // projected_pressure is nowhere near the threshold.
    const capped = createBudgetGate({
      config: defaultConfig({ task_usd: 5 }),
      meter: createTokenMeter(),
      clock: FIXED_CLOCK,
    });
    // projected_cost_usd 8 > task_usd 5; projected_pressure = 8/100 = 0.08.
    const cappedResult = capped.project(makeProjection(8));
    expect(cappedResult.projected_pressure).toBeCloseTo(0.08);
    expect(cappedResult.would_exceed).toBe(true);
    capped.dispose();

    // Same projection, task_usd undefined → no per-spawn cap → would_exceed false.
    const uncapped = createBudgetGate({
      config: defaultConfig(), // task_usd omitted
      meter: createTokenMeter(),
      clock: FIXED_CLOCK,
    });
    const uncappedResult = uncapped.project(makeProjection(8));
    expect(uncappedResult.would_exceed).toBe(false);
    uncapped.dispose();
  });

  it('projection_enabled: false short-circuits would_exceed but keeps projected_pressure honest', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({
      config: defaultConfig({ projection_enabled: false, task_usd: 1 }),
      meter,
      clock: FIXED_CLOCK,
    });

    // A projection that would blow the ceiling AND the task_usd cap.
    const result = gate.project(makeProjection(150));
    // Halt is suppressed...
    expect(result.would_exceed).toBe(false);
    // ...but projected_pressure is still the honest computed value (> 1.0).
    expect(result.projected_pressure).toBeCloseTo(1.5);
    expect(result.projected_pressure).toBeGreaterThan(1);
    gate.dispose();
  });

  it('confidence does not soften the halt — a low-confidence over-threshold projection still halts (R4)', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });

    // spent = 90 / ceiling 100; +6 → projected_pressure 0.96 ≥ 0.95.
    meter.record(makeRecord(90), 90);

    const low = gate.project(makeProjection(6, { confidence: 'low' }));
    const medium = gate.project(makeProjection(6, { confidence: 'medium' }));

    // Identical halt decision regardless of confidence band.
    expect(low.would_exceed).toBe(true);
    expect(medium.would_exceed).toBe(true);
    expect(low.would_exceed).toBe(medium.would_exceed);
    gate.dispose();
  });

  it('echoes the same projection object back unchanged on the result', () => {
    const meter = createTokenMeter();
    const gate = createBudgetGate({ config: defaultConfig(), meter, clock: FIXED_CLOCK });

    const projection = makeProjection(3);
    const result = gate.project(projection);
    // Same reference — no copy, no mutation (event-payload echo).
    expect(result.projection).toBe(projection);
    gate.dispose();
  });
});
