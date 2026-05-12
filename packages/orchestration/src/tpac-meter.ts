/**
 * TPAC aggregator per TDD2 §8.1.
 *
 * Sits on top of the runtime's `TokenMeter` (which records per-turn
 * `MeterRecord` rows) and reduces a snapshot into a milestone-scoped
 * `TpacReport`. The runtime layer owns metering (per Principle 1 —
 * runtime is the only layer importing Pi); the orchestration layer
 * owns the methodology-level interpretation (TPAC, cache hit ratio at
 * M4 PR-33, criteria-satisfied counting).
 *
 * Two entry points:
 *
 *   - `computeTpac(snapshot, opts)` — pure aggregator. Filters the
 *     snapshot's records by milestone, sums input/output, divides by
 *     the supplied `criteria_satisfied` count, returns a validated
 *     `TpacReport`.
 *   - `summariseRoles(snapshot, opts)` — per-role breakdown used by
 *     the dashboard's Milestones panel (M2 PR-17 wiring) and `swt
 *     bench` (M2 PR-21) for the verbose report.
 *
 * **What this DOESN'T do:** it does not run the milestone itself.
 * That's `packages/test-utils/src/run-milestone.ts` (PR-18). This is
 * the post-run number cruncher.
 */

import {
  TpacReportSchema,
  type MeterRecord,
  type MeterSnapshot,
  type TpacReport,
} from '@swt-labs/shared';

export interface ComputeTpacOptions {
  /** Milestone identifier — used both to filter records AND to label the report. */
  readonly milestone: string;
  /** Fixture identifier (e.g. `ref-fastapi-empty`). */
  readonly fixture: string;
  /**
   * Count of P0 must-haves that QA verified as `passed`. Producers
   * pull this from the VERIFICATION.md result or the `verification`
   * array in the QA TaskResult. Zero → throw (the bench run should
   * have failed before reaching this aggregator).
   */
  readonly criteria_satisfied: number;
  /**
   * Provider override. When omitted, the dominant provider in the
   * filtered records is used (the one that contributed the most
   * tokens). Most runs are single-provider so this is rarely needed.
   */
  readonly provider?: string;
  /**
   * Model override. When omitted, derived the same way as `provider`.
   * The dominant model is the one with the most tokens.
   */
  readonly model?: string;
  /**
   * Cost in USD. When omitted, summed from the records'
   * `cost_usd` field. M2 baseline runs cost calculation is
   * still stub (cost rate-card lookup lands at M4 PR-33), so the
   * summed value may be `0` — the schema's `cost_usd` field is
   * optional and producers should omit it when sum is zero.
   */
  readonly cost_usd?: number;
  /**
   * Override the recorded-at timestamp (for deterministic tests).
   * Defaults to `new Date().toISOString()`.
   */
  readonly recordedAt?: string;
}

export class NoSatisfiedCriteriaError extends Error {
  constructor() {
    super(
      'computeTpac: criteria_satisfied is 0. A TpacReport with zero ' +
        'denominator is meaningless (tokens_per_criterion = Infinity). ' +
        'The bench run should have failed before reaching the aggregator; ' +
        'pass at least one satisfied criterion or treat the run as a hard ' +
        'failure rather than emitting a report.',
    );
    this.name = 'NoSatisfiedCriteriaError';
  }
}

/**
 * Reduce a `MeterSnapshot` into a milestone-scoped `TpacReport`.
 *
 * Filters records by `opts.milestone` (records carry a `milestone`
 * dimension on every row per TDD2 §8.1 — populated by the runtime
 * via `SwtSessionOptions.meterContext`). The reduction:
 *
 *   tpac_input  = sum(record.input)   for records in the milestone
 *   tpac_output = sum(record.output)  for records in the milestone
 *   tpac_total  = tpac_input + tpac_output
 *   tokens_per_criterion = tpac_total / criteria_satisfied  (rounded to 2dp)
 *
 * Provider + model default to the dominant contributors when not
 * supplied. The result is validated against `TpacReportSchema` before
 * being returned — emit-time validation catches drift between this
 * aggregator and the schema's frozen contract.
 */
export function computeTpac(snapshot: MeterSnapshot, opts: ComputeTpacOptions): TpacReport {
  if (opts.criteria_satisfied <= 0) {
    throw new NoSatisfiedCriteriaError();
  }
  const filtered = snapshot.records.filter((r) => r.milestone === opts.milestone);
  const tpac_input = sumField(filtered, 'input');
  const tpac_output = sumField(filtered, 'output');
  const tpac_total = tpac_input + tpac_output;
  const tokens_per_criterion = round2(tpac_total / opts.criteria_satisfied);
  const provider = opts.provider ?? dominantField(filtered, 'provider');
  const model = opts.model ?? dominantField(filtered, 'model');
  const cost_usd = opts.cost_usd ?? sumField(filtered, 'cost_usd');

  const candidate: TpacReport = {
    schema_version: 1,
    milestone: opts.milestone,
    fixture: opts.fixture,
    provider,
    model,
    tpac_input,
    tpac_output,
    tpac_total,
    criteria_satisfied: opts.criteria_satisfied,
    tokens_per_criterion,
    ...(cost_usd > 0 ? { cost_usd } : {}),
    recorded_at: opts.recordedAt ?? new Date().toISOString(),
  };
  return TpacReportSchema.parse(candidate);
}

export interface RoleSummary {
  readonly role: string;
  readonly input: number;
  readonly output: number;
  readonly total: number;
  readonly turns: number;
  /** Fraction of `tpac_total` consumed by this role (0..1). */
  readonly share: number;
}

/**
 * Per-role breakdown of a milestone's token consumption. Useful for the
 * dashboard Milestones panel + `swt bench --verbose` (PR-21).
 *
 * Roles surfaced verbatim (lowercased): `scout`, `architect`, `lead`,
 * `dev`, `qa`, `debugger`. Unknown roles in the snapshot pass through
 * — the methodology evolves; new roles will appear without code
 * changes here.
 */
export function summariseRoles(
  snapshot: MeterSnapshot,
  opts: { milestone: string },
): ReadonlyArray<RoleSummary> {
  const filtered = snapshot.records.filter((r) => r.milestone === opts.milestone);
  const byRole = new Map<string, { input: number; output: number; turns: number }>();
  for (const record of filtered) {
    const key = record.role.toLowerCase();
    const entry = byRole.get(key) ?? { input: 0, output: 0, turns: 0 };
    entry.input += record.input;
    entry.output += record.output;
    entry.turns += 1;
    byRole.set(key, entry);
  }
  const totalAllRoles = Array.from(byRole.values()).reduce((sum, e) => sum + e.input + e.output, 0);
  const summaries: RoleSummary[] = [];
  for (const [role, e] of byRole) {
    const total = e.input + e.output;
    summaries.push({
      role,
      input: e.input,
      output: e.output,
      total,
      turns: e.turns,
      share: totalAllRoles > 0 ? total / totalAllRoles : 0,
    });
  }
  // Sort by total desc — the dashboard renders most-expensive-role-first.
  summaries.sort((a, b) => b.total - a.total);
  return summaries;
}

// ───────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────

function sumField(
  records: ReadonlyArray<MeterRecord>,
  field: 'input' | 'output' | 'cost_usd',
): number {
  let acc = 0;
  for (const r of records) {
    acc += r[field];
  }
  return acc;
}

function dominantField(records: ReadonlyArray<MeterRecord>, field: 'provider' | 'model'): string {
  if (records.length === 0) return 'unknown';
  const tally = new Map<string, number>();
  for (const r of records) {
    const key = r[field];
    tally.set(key, (tally.get(key) ?? 0) + r.input + r.output);
  }
  let bestKey = '';
  let bestTotal = -1;
  for (const [key, total] of tally) {
    if (total > bestTotal) {
      bestKey = key;
      bestTotal = total;
    }
  }
  return bestKey || 'unknown';
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}
