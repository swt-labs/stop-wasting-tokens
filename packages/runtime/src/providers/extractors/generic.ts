/**
 * Generic / best-effort usage extractor.
 *
 * Catch-all for providers that don't fit the Anthropic or OpenAI shapes
 * (Ollama, Bedrock-via-non-Anthropic-models, OpenRouter sub-routes).
 * Inspects the raw usage object for any of the canonical field names
 * and reports whatever it can. Cache fields default to 0.
 *
 * This extractor never throws; an unrecognised shape returns
 * `undefined`, which the event mapper interprets as "no usage to record
 * for this turn." That is preferable to fabricating zeros, which would
 * masquerade as a real (cost-zero) turn in the meter snapshot.
 */

import type { TaskTokenUsage } from '@swt-labs/shared';

interface GenericUsageLike {
  readonly input_tokens?: number;
  readonly prompt_tokens?: number;
  readonly inputTokens?: number;
  readonly output_tokens?: number;
  readonly completion_tokens?: number;
  readonly outputTokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cached_tokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cacheWriteInputTokens?: number;
}

function firstDefined(...candidates: ReadonlyArray<number | undefined>): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

export function extractGeneric(
  usage: unknown,
  ctx: { readonly turn: number; readonly provider: string; readonly model: string },
): TaskTokenUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const u = usage as GenericUsageLike;
  const input = firstDefined(u.input_tokens, u.prompt_tokens, u.inputTokens);
  const output = firstDefined(u.output_tokens, u.completion_tokens, u.outputTokens);
  if (input === undefined && output === undefined) return undefined;
  const cacheRead = firstDefined(u.cache_read_input_tokens, u.cached_tokens, u.cacheReadInputTokens) ?? 0;
  const cacheWrite = firstDefined(u.cache_creation_input_tokens, u.cacheWriteInputTokens) ?? 0;
  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead,
    cacheWrite,
    turn: ctx.turn,
    provider: ctx.provider,
    model: ctx.model,
  };
}
