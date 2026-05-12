/**
 * TPAC (Tokens Per Acceptance Criterion) report schema per TDD2 §8.1.
 *
 * The TPAC report is the headline cost-efficiency metric for the v3
 * methodology. It captures, for a single milestone run against a
 * frozen fixture + recorded cassettes:
 *
 *   - The total tokens consumed across all six roles (input + output).
 *   - The count of P0 must-haves that QA verified as `passed`.
 *   - The ratio: `tokens_per_criterion = (input + output) / criteria`.
 *
 * Used at two boundaries:
 *
 *   1. **`swt bench` emit** (M2 PR-21) — produces a `TpacReport` when
 *      the bench subcommand replays a cassette set against the
 *      methodology. Validated before printing.
 *   2. **`test/regression` consume** — when M4 PR-32 wires the −40%
 *      target check, it reads the historical TpacReports from
 *      `.vbw-planning/v3-tracking.md` (or `swt bench` output) and
 *      computes the delta against the M2 baseline.
 *
 * The schema is frozen at `schema_version: 1`. Any field-level change
 * requires a new schema version + an ADR.
 */

import { z } from 'zod';

export const TpacReportSchema = z.object({
  /** Schema version pinned at 1 for the v3.0 release window. */
  schema_version: z.literal(1),
  /**
   * Milestone identifier (e.g. `M2`, `M4`, `M5`). Free-form but
   * convention is short uppercase per TDD2 §13.
   */
  milestone: z.string().min(1),
  /**
   * Fixture identifier (e.g. `ref-fastapi-empty`). Matches the
   * directory name under `packages/test-utils/golden/`.
   */
  fixture: z.string().min(1),
  /**
   * Provider that served the LLM calls (`anthropic`, `openai`,
   * `openrouter`, `google`, `bedrock`, `ollama`). Used by M5's
   * provider-matrix comparison.
   */
  provider: z.string().min(1),
  /**
   * Provider-native model identifier (e.g.
   * `claude-sonnet-4-5-20250929`). The tier vocabulary
   * (`cheap-fast|balanced|quality|reasoning`) is resolved per-provider
   * in `runtime/src/providers/default-tiers.json` — this field carries
   * the concrete model that was actually invoked.
   */
  model: z.string().min(1),
  /** Sum of input tokens across every turn in the milestone run. */
  tpac_input: z.number().int().nonnegative(),
  /** Sum of output tokens across every turn. */
  tpac_output: z.number().int().nonnegative(),
  /** Sum of input + output. Materialised so consumers don't re-add. */
  tpac_total: z.number().int().nonnegative(),
  /**
   * Count of P0 must-haves that QA verified as `passed`. The TPAC
   * denominator. If zero (no passing must-haves), `tokens_per_criterion`
   * is reported as `Infinity` per the consumer contract — but the
   * schema rejects it because the JSON encoding of Infinity is
   * non-standard. Producers must avoid emitting reports with zero
   * criteria_satisfied (they should fail the bench run instead).
   */
  criteria_satisfied: z.number().int().nonnegative(),
  /**
   * `tpac_total / criteria_satisfied` rounded to 2 decimal places.
   * Materialised so consumers can compare runs without re-computing.
   * Must be a finite non-negative number; producers must guard against
   * division-by-zero before emitting the report.
   */
  tokens_per_criterion: z.number().nonnegative().finite(),
  /**
   * Cost in USD computed by the runtime meter using the provider rate
   * card. Optional because cost calculation is M4 PR-33 territory —
   * the M2 baseline ships token counts only; M4+ reports include cost.
   */
  cost_usd: z.number().nonnegative().optional(),
  /** ISO 8601 timestamp of when the report was recorded. */
  recorded_at: z.string().datetime({ offset: true }),
});

export type TpacReport = z.infer<typeof TpacReportSchema>;
