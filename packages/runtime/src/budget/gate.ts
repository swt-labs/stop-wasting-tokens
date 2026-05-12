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

export interface BudgetGate {
  state(): BudgetGateState;
  subscribe(listener: (event: BudgetEvent) => void): () => void;
  bumpCeiling(delta_usd: number): void;
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
    dispose(): void {
      unsubscribe();
      listeners.length = 0;
    },
  };
}
