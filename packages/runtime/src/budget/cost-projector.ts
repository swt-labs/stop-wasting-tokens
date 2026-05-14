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
