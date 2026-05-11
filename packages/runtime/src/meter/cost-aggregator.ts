/**
 * Cost calculation — per TDD2 §7.6.
 *
 * Provider rate cards are denominated in dollars-per-million-tokens. The
 * usage object carries raw token counts (input, output, cacheRead,
 * cacheWrite) per turn; multiplying component-wise and dividing by 1e6
 * gives the per-turn dollar cost. Pure function; trivially testable.
 *
 * Cache pricing varies per provider:
 *   - Anthropic: cacheRead is 0.1x the input rate; cacheWrite is 1.25x.
 *   - OpenAI: cacheRead is 0.5x the input rate; no cacheWrite.
 *   - Others: caller passes 0 for unsupported cache dimensions.
 *
 * The aggregator does not know the rate ratios — callers pass the
 * effective per-million rates as `modelCost.cacheRead` /
 * `modelCost.cacheWrite`. This keeps the function provider-agnostic.
 */

export interface UsageCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export function calculateCost(usage: UsageCounts, modelCost: ModelCost): number {
  return (
    (usage.input * modelCost.input +
      usage.output * modelCost.output +
      usage.cacheRead * modelCost.cacheRead +
      usage.cacheWrite * modelCost.cacheWrite) /
    1_000_000
  );
}
