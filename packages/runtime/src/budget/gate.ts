/**
 * Budget Gate per TDD2 §8.4 + ADR-007 + Plan 04-01 PR-35.
 *
 * Subscribes to a `TokenMeter` and fires three signals as spend pressure
 * crosses configured thresholds:
 *
 *   - `budget.warning` at 70% (default; configurable via
 *     `tier_downgrade_threshold`) — methodology layer downgrades tier per
 *     ADR-007. Fires once when pressure crosses the threshold; does not
 *     re-fire on every subsequent tick.
 *   - `budget.pause` at 95% (default; configurable via `pause_threshold`)
 *     — milestone halts. Dashboard's `BudgetPanel` surfaces the resume
 *     UX. Fires once when pressure crosses the threshold.
 *   - `budget.resume` — emitted after `bumpCeiling(delta_usd)` when the
 *     ceiling bump drops pressure back below the warning threshold.
 *     Resets `status` back to `'ok'`.
 *
 * Pure event-driven; no IO. The dashboard route + persistence layer
 * compose on top.
 *
 * **State-machine invariants:**
 *   - Each threshold fires once per "crossing" (transition from below to
 *     at-or-above). `bumpCeiling` resets the state so a future crossing
 *     can fire again.
 *   - Pressure is computed AFTER every meter tick — `evaluate()` does the
 *     transition check inside the subscriber callback. Rapid-fire ticks
 *     (>100/sec) don't duplicate events because the status field gates
 *     re-emission.
 *   - The first observation that already exceeds the warning threshold
 *     fires both `budget.warning` AND `budget.pause` in one tick if the
 *     pressure crossed both at once.
 */

import type { BudgetConfigSchemaT, TokenMeter } from '@swt-labs/shared';

import type { CostProjection } from './cost-projector.js';

export type BudgetStatus = 'ok' | 'warning' | 'paused';

export type BudgetEvent =
  | {
      readonly type: 'budget.warning';
      readonly ts: string;
      readonly spent_usd: number;
      readonly ceiling_usd: number;
      readonly threshold: number;
    }
  | {
      readonly type: 'budget.pause';
      readonly ts: string;
      readonly spent_usd: number;
      readonly ceiling_usd: number;
      readonly threshold: number;
    }
  | {
      readonly type: 'budget.resume';
      readonly ts: string;
      readonly spent_usd: number;
      readonly ceiling_usd: number;
    };

export interface BudgetGateState {
  readonly spent_usd: number;
  readonly ceiling_usd: number;
  /** `spent / ceiling`, in [0, 1]. Zero when ceiling is zero (avoid NaN). */
  readonly pressure: number;
  readonly status: BudgetStatus;
  /** ISO timestamp when `budget.warning` last fired. Undefined when never. */
  readonly warning_fired_at?: string;
  /** ISO timestamp when `budget.pause` last fired. Undefined when never. */
  readonly paused_at?: string;
}

export interface BudgetGateOptions {
  readonly config: BudgetConfigSchemaT;
  readonly meter: TokenMeter;
  /** Override the clock for tests. Default: `() => new Date().toISOString()`. */
  readonly clock?: () => string;
}

/**
 * Result of `BudgetGate.project()` — the pure forward-looking read (G-R4).
 *
 * `would_exceed` is the binary halt signal: `true` when the projected
 * pressure crosses `projection_halt_threshold ?? pause_threshold` OR when
 * `projected_cost_usd` exceeds the per-spawn `task_usd` cap. Computed purely
 * from the conservative worst-case `projected_cost_usd` — `confidence` is
 * NEVER consulted (R4: a low-confidence over-threshold projection is exactly
 * when to halt; confidence is a downstream display concern).
 */
export interface BudgetProjectionResult {
  /** Binary halt signal — true iff this spawn would cross the halt cutoff. */
  readonly would_exceed: boolean;
  /** `(spent + projected_cost_usd) / ceiling`, NaN-guarded. Telemetry-honest. */
  readonly projected_pressure: number;
  /** The projection echoed back unchanged (no copy, no mutation). */
  readonly projection: CostProjection;
}

export interface BudgetGate {
  state(): BudgetGateState;
  subscribe(listener: (event: BudgetEvent) => void): () => void;
  bumpCeiling(delta_usd: number): void;
  /**
   * Pure forward-looking read (R3 complement) — answers "if this spawn costs
   * `projection.projected_cost_usd`, would we cross the halt threshold?".
   * Never mutates gate state, never fires a `BudgetEvent`. When
   * `config.projection_enabled === false` it short-circuits to
   * `would_exceed: false` while still returning an honest `projected_pressure`.
   */
  project(projection: CostProjection): BudgetProjectionResult;
  dispose(): void;
}

export function createBudgetGate(opts: BudgetGateOptions): BudgetGate {
  const config = opts.config;
  const meter = opts.meter;
  const clock = opts.clock ?? ((): string => new Date().toISOString());

  let ceiling = config.milestone_usd;
  let spent = 0;
  let status: BudgetStatus = 'ok';
  let warningFiredAt: string | undefined;
  let pausedAt: string | undefined;

  const listeners: Array<(event: BudgetEvent) => void> = [];

  const emit = (event: BudgetEvent): void => {
    for (const l of [...listeners]) l(event);
  };

  const pressure = (): number => (ceiling > 0 ? spent / ceiling : 0);

  const evaluate = (): void => {
    const p = pressure();
    if (status === 'ok' && p >= config.tier_downgrade_threshold) {
      status = 'warning';
      warningFiredAt = clock();
      emit({
        type: 'budget.warning',
        ts: warningFiredAt,
        spent_usd: spent,
        ceiling_usd: ceiling,
        threshold: config.tier_downgrade_threshold,
      });
    }
    if (status !== 'paused' && p >= config.pause_threshold) {
      status = 'paused';
      pausedAt = clock();
      emit({
        type: 'budget.pause',
        ts: pausedAt,
        spent_usd: spent,
        ceiling_usd: ceiling,
        threshold: config.pause_threshold,
      });
    }
  };

  const unsubscribe = meter.subscribe((update) => {
    spent += update.record.cost_usd;
    evaluate();
  });

  return {
    state(): BudgetGateState {
      return {
        spent_usd: spent,
        ceiling_usd: ceiling,
        pressure: pressure(),
        status,
        ...(warningFiredAt !== undefined ? { warning_fired_at: warningFiredAt } : {}),
        ...(pausedAt !== undefined ? { paused_at: pausedAt } : {}),
      };
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    bumpCeiling(delta_usd: number): void {
      ceiling += delta_usd;
      const wasOver = status !== 'ok';
      const p = pressure();
      // Re-evaluate thresholds against the new ceiling.
      if (p < config.tier_downgrade_threshold) {
        status = 'ok';
        warningFiredAt = undefined;
        pausedAt = undefined;
      } else if (p < config.pause_threshold) {
        status = 'warning';
        pausedAt = undefined;
      }
      // Fire `budget.resume` if we were in warning OR paused and dropped
      // back to ok (state reset above).
      if (wasOver && status === 'ok') {
        emit({
          type: 'budget.resume',
          ts: clock(),
          spent_usd: spent,
          ceiling_usd: ceiling,
        });
      }
    },
    project(projection: CostProjection): BudgetProjectionResult {
      // Pure read (R3 complement) — reads the LIVE closure `ceiling` (so a
      // prior `bumpCeiling` is reflected) and `spent`, mutates NOTHING:
      // never touches `spent` / `status` / `warningFiredAt` / `pausedAt`,
      // never calls `evaluate()`, never emits a `BudgetEvent`.
      const projectedSpent = spent + projection.projected_cost_usd;
      const projected_pressure = ceiling > 0 ? projectedSpent / ceiling : 0;
      // R6.2 short-circuit — projection disabled means the gate never halts
      // on a projection, but the result still carries an honest
      // `projected_pressure` for the dashboard (plan 03-04 telemetry).
      if (config.projection_enabled === false) {
        return { would_exceed: false, projected_pressure, projection };
      }
      // Threshold-crossing check — the projection-path cutoff reuses
      // `pause_threshold` when `projection_halt_threshold` is undefined.
      const haltAt = config.projection_halt_threshold ?? config.pause_threshold;
      const overThreshold = projected_pressure >= haltAt;
      // Per-spawn cap check — makes the previously-declared-but-unconsumed
      // `task_usd` schema field LIVE for the first time (research §6.3).
      const overTaskCap =
        config.task_usd !== undefined &&
        projection.projected_cost_usd > config.task_usd;
      // R4 — `would_exceed` is computed purely from the conservative
      // worst-case `projected_cost_usd`; it does NOT inspect
      // `projection.confidence` (confidence is a downstream display concern).
      return {
        would_exceed: overThreshold || overTaskCap,
        projected_pressure,
        projection,
      };
    },
    dispose(): void {
      unsubscribe();
      listeners.length = 0;
    },
  };
}
