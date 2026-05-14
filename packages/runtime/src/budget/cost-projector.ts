/**
 * Phase 3 / Plan 03-01 (G-R4) — Pure pre-spawn cost projector.
 *
 * Turns a pre-spawn prompt (resolved role prompt + overlay + task body) plus
 * the per-provider rate card into a USD projection BEFORE `spawnAgent` /
 * `spawnOrchestratorSession` runs, so the BudgetGate can refuse a spawn that
 * would blow the budget rather than reacting after tokens are already spent.
 *
 * Pure arithmetic + schema module — NO file IO, NO clock, NO `fs`/`path`/
 * `chokidar`. It must NOT import from `@swt-labs/orchestration` or
 * `@swt-labs/cli` (would invert the package dependency graph — runtime sits
 * BELOW orchestration). The rate card is passed in as a value; the cook
 * callsite owns the `createRateCardSource(...).readCurrent()` disk IO.
 *
 * Sibling of `gate.ts` + `rate-card-source.ts` in `packages/runtime/src/budget/`.
 *
 * **Architect decisions (Phase 3 R1/R2/R5):**
 *   - R1 — token estimation: char-heuristic `Math.ceil(chars / CHARS_PER_TOKEN)`,
 *     zero npm dep (vendor-agnostic by construction). A documented
 *     `estimateTokens?` swap seam in `ProjectSpawnCostOptions` lets a future
 *     plan drop in a real BPE tokenizer without touching callers.
 *   - R2 — output projection: `maxTurns`-bounded worst case
 *     (`maxTurns * outputTokensPerTurn`) is the GATING number the halt-gate
 *     reads. A fixed-multiplier mid-point (`projected_input_tokens * outputRatio`)
 *     is returned ONLY as the informational `expected_cost_usd` — it never
 *     drives `projected_cost_usd`. `confidence: 'high'` is unreachable in
 *     Phase 3 (reserved for a future plan with real per-role historical
 *     output averages from `.metrics/`).
 *   - R5 — cache-hit modeling: cold pricing by default (price the whole prompt
 *     at `input_per_1k` — a halt-gate should OVER-project). `opts.assumeWarmPrefix`
 *     opts into warm-prefix pricing: the `systemPrompt` token slice is priced
 *     at `cache_read_per_1k` (when the entry has it), the `taskPrompt` slice at
 *     `input_per_1k`. Non-Anthropic entries have no cache fields, so warm == cold.
 */

import type { RateCard, RateCardEntry } from '@swt-labs/shared';

/**
 * R1 char-heuristic divisor — `tokens ≈ chars / 4` for English methodology
 * prose + code. A named constant so the heuristic is visible at callsites and
 * the `assumptions[]` honesty surface can cite it.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * The conservative input→output multiplier for the informational
 * `expected_cost_usd` mid-point. Research §2.4 suggests ~1.5-2.5x for coding
 * agents that emit code + explanations; 2 is the middle of that band. This
 * feeds `expected_cost_usd` ONLY — never the gating `projected_cost_usd`.
 */
export const DEFAULT_OUTPUT_RATIO = 2;

/**
 * The per-turn worst-case output estimate (tokens). Multiplied by `maxTurns`
 * for the gating `projected_output_tokens` (research §2.4 option 2 — the
 * `maxTurns`-bounded worst-case upper bound a halt-gate wants).
 */
export const DEFAULT_OUTPUT_TOKENS_PER_TURN = 800;

/**
 * R1 char-heuristic token estimator. Pure, deterministic — `estimateTokens('')`
 * is `0`, and the result is `Math.ceil(text.length / CHARS_PER_TOKEN)`.
 *
 * The default `estimateTokens` implementation for `projectSpawnCost`; callers
 * can swap in a real tokenizer via `ProjectSpawnCostOptions.estimateTokens`.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * The pre-spawn inputs the projector measures. All strings are plain text the
 * cook callsite already holds before `spawnAgent` / `spawnOrchestratorSession`
 * runs (resolved role prompt + overlay, the task body, `maxTurns`, and the
 * router-resolved primary provider).
 */
export interface SpawnProjectionInput {
  /** The resolved role prompt + provider overlay — the system-prompt prefix. */
  readonly systemPrompt: string;
  /** The task body carried into `brief.promptContext.prompt`. */
  readonly taskPrompt: string;
  /** The spawn's turn budget — multiplied by the per-turn worst-case estimate. */
  readonly maxTurns: number;
  /** The router-resolved primary provider — selects the rate-card entry. */
  readonly provider: string;
  /** Optional model pin; when omitted the first provider-matching entry wins. */
  readonly model?: string;
}

/**
 * Optional knobs for `projectSpawnCost`. Every field has a documented default
 * so the common callsite passes `(input, rateCard)` only.
 */
export interface ProjectSpawnCostOptions {
  /**
   * R1 swap seam — a custom token estimator (e.g. a future BPE tokenizer).
   * Defaults to the module's `estimateTokens` char-heuristic.
   */
  readonly estimateTokens?: (text: string) => number;
  /**
   * The input→output multiplier for the informational `expected_cost_usd`
   * mid-point. Defaults to `DEFAULT_OUTPUT_RATIO`.
   */
  readonly outputRatio?: number;
  /**
   * The per-turn worst-case output estimate (tokens) — multiplied by
   * `maxTurns` for the gating `projected_output_tokens`. Defaults to
   * `DEFAULT_OUTPUT_TOKENS_PER_TURN`.
   */
  readonly outputTokensPerTurn?: number;
  /**
   * R5 — opt into warm-prefix pricing: the `systemPrompt` token slice is
   * priced at `cache_read_per_1k` (when the entry has it). Defaults to
   * `false` = cold pricing (whole prompt at `input_per_1k`).
   */
  readonly assumeWarmPrefix?: boolean;
}

/**
 * The projection result. `projected_cost_usd` is the WORST-CASE gating number
 * the halt-gate reads; `expected_cost_usd` is the informational mid-point for
 * the dashboard. The shape plan 03-03's `BudgetGate.project()` and plan
 * 03-02's `cook.budget_projected` event consume.
 */
export interface CostProjection {
  /**
   * The WORST-CASE gating number — input cost + `maxTurns`-bounded worst-case
   * output cost. This is what the halt-gate refuses a spawn on.
   */
  readonly projected_cost_usd: number;
  /**
   * The informational mid-point — input cost + `outputRatio`-multiplied output
   * cost. Always populated in Phase 3 (the multiplier path always runs).
   */
  readonly expected_cost_usd?: number;
  /** `estimateTokens(systemPrompt) + estimateTokens(taskPrompt)`. */
  readonly projected_input_tokens: number;
  /** The worst-case `maxTurns * outputTokensPerTurn` count (NOT the multiplier). */
  readonly projected_output_tokens: number;
  /** `'high'` is unreachable in Phase 3 — reserved for real historical averages. */
  readonly confidence: 'high' | 'medium' | 'low';
  /** Ordered honesty surface — each ≤ ~80 chars, capped at 8 entries. */
  readonly assumptions: readonly string[];
  /** Copied from `rateCard.source` for telemetry provenance. */
  readonly rate_card_source: 'embedded' | 'project-override' | 'fetched';
}

/** Max `assumptions[]` entries — respects plan 03-02's PIPE_BUF event cap. */
const MAX_ASSUMPTIONS = 8;

/** `cost = (tokens / 1000) * per1k` — research §3.1, per-1k units. */
function priceTokens(tokens: number, per1k: number): number {
  return (tokens / 1000) * per1k;
}

/**
 * Pure pre-spawn cost projector — measures the resolved system + task prompt,
 * projects output tokens as a `maxTurns`-bounded worst case (R2 gating number)
 * AND a fixed-multiplier mid-point, prices both against the rate-card entry
 * using cold pricing by default (R5), falls back to the first anthropic entry
 * on a provider miss (forcing `confidence: 'low'`), and derives the confidence
 * band + `assumptions[]` honesty surface.
 *
 * Total + deterministic — never throws for a valid `SpawnProjectionInput` and
 * a Zod-valid `RateCard` (≥1 entry guaranteed by `RateCardSchema`). `maxTurns`
 * of 0 yields `projected_output_tokens === 0` and a still-valid input-only
 * projection. All returned numbers are finite + non-negative.
 */
export function projectSpawnCost(
  input: SpawnProjectionInput,
  rateCard: RateCard,
  opts?: ProjectSpawnCostOptions,
): CostProjection {
  const estimate = opts?.estimateTokens ?? estimateTokens;
  const outputRatio = opts?.outputRatio ?? DEFAULT_OUTPUT_RATIO;
  const outputTokensPerTurn =
    opts?.outputTokensPerTurn ?? DEFAULT_OUTPUT_TOKENS_PER_TURN;
  const assumeWarmPrefix = opts?.assumeWarmPrefix ?? false;

  // --- Token projection -----------------------------------------------------
  const systemTokens = estimate(input.systemPrompt);
  const taskTokens = estimate(input.taskPrompt);
  const projected_input_tokens = systemTokens + taskTokens;

  // R2 — `maxTurns`-bounded worst case is the GATING output count.
  const projected_output_tokens = input.maxTurns * outputTokensPerTurn;
  // Informational mid-point — feeds `expected_cost_usd` ONLY.
  const expected_output_tokens = Math.ceil(projected_input_tokens * outputRatio);

  // --- Rate-card entry lookup ----------------------------------------------
  // Mirrors `rate-card-source.ts:find` — first match on provider, model-
  // agnostic when `model` omitted.
  const matchedEntry: RateCardEntry | undefined = rateCard.entries.find(
    (e) =>
      e.provider === input.provider &&
      (input.model === undefined || e.model === input.model),
  );
  const providerMiss = matchedEntry === undefined;
  // On a miss, fall back to the first anthropic entry, else the first entry
  // overall. `RateCardSchema` guarantees `entries.min(1)`, so `entries[0]` is
  // always defined at runtime — the `?? entries[0]!` covers the type narrowing.
  const fallbackEntry: RateCardEntry =
    rateCard.entries.find((e) => e.provider === 'anthropic') ??
    (rateCard.entries[0] as RateCardEntry);
  const entry: RateCardEntry = matchedEntry ?? fallbackEntry;

  // --- Pricing (R5 — cold default) -----------------------------------------
  const warmApplied =
    assumeWarmPrefix && entry.cache_read_per_1k !== undefined;
  const inputCost = warmApplied
    ? priceTokens(systemTokens, entry.cache_read_per_1k as number) +
      priceTokens(taskTokens, entry.input_per_1k)
    : priceTokens(projected_input_tokens, entry.input_per_1k);

  const projected_cost_usd =
    inputCost + priceTokens(projected_output_tokens, entry.output_per_1k);
  const expected_cost_usd =
    inputCost + priceTokens(expected_output_tokens, entry.output_per_1k);

  // --- Confidence (research §5) --------------------------------------------
  // Provider-miss → `low`; otherwise `medium`. `high` is unreachable in
  // Phase 3 (reserved for real per-role historical output averages).
  const confidence: CostProjection['confidence'] = providerMiss
    ? 'low'
    : 'medium';

  // --- Assumptions honesty surface -----------------------------------------
  const assumptions: string[] = [
    'input estimated via char/4 heuristic',
    `output bounded at maxTurns(${input.maxTurns}) x ${outputTokensPerTurn} tok/turn worst case`,
    warmApplied
      ? 'warm prefix assumed: system prompt priced at cache_read rate'
      : 'cache priced cold (no prefix reuse assumed)',
    `rate card source: ${rateCard.source}`,
  ];
  if (providerMiss) {
    assumptions.push(
      `provider '${input.provider}' not in rate card - priced at ${fallbackEntry.provider}/${fallbackEntry.model} fallback`,
    );
  }
  // Cap at MAX_ASSUMPTIONS — drop from the END (always-present notes first).
  const cappedAssumptions = assumptions.slice(0, MAX_ASSUMPTIONS);

  return {
    projected_cost_usd,
    expected_cost_usd,
    projected_input_tokens,
    projected_output_tokens,
    confidence,
    assumptions: cappedAssumptions,
    rate_card_source: rateCard.source,
  };
}
