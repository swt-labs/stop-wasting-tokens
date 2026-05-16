/**
 * OpenAI usage extractor.
 *
 * OpenAI's `usage` object on chat-completion responses carries:
 *   - `prompt_tokens` — input tokens (includes cache-read tokens)
 *   - `completion_tokens` — generated tokens
 *   - `prompt_tokens_details.cached_tokens` — cache-read subset of prompt_tokens
 *   - `reasoning_tokens` — separate billing dimension for o-series; surfaced
 *     to dashboards via the broader runtime telemetry, not the per-task
 *     `TaskTokenUsage` shape (which carries only the four canonical fields).
 *
 * No cacheWrite dimension at the OpenAI API surface — caching is opaque
 * from the user side. We subtract cached_tokens from prompt_tokens so
 * the `input` field reports fresh-prompt tokens only (parity with
 * Anthropic's `input_tokens` semantics).
 */

import type { TaskTokenUsage } from '@swt-labs/shared';

interface OpenAIUsageLike {
  // Real OpenAI API response shape (snake_case).
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
  };
  // alpha.21 — Pi `withUsageEstimate` shape (camelCase). Same accept-both
  // contract as the Anthropic extractor — Pi normalises both providers
  // into this shape for mock + non-billable error paths.
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
}

export function extractOpenAI(
  usage: unknown,
  ctx: { readonly turn: number; readonly provider: string; readonly model: string },
): TaskTokenUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const u = usage as OpenAIUsageLike;
  if (u.prompt_tokens === undefined && u.completion_tokens === undefined) {
    // Pre-alpha.21 path: no snake_case fields. Fall through to the
    // camelCase branch below — Pi's withUsageEstimate shape.
    if (u.input === undefined && u.output === undefined) {
      return undefined;
    }
    return {
      // camelCase Pi shape — `input` is already fresh-prompt-only
      // (Pi's estimate excludes cache reads from input by construction),
      // so no subtraction.
      input: u.input ?? 0,
      output: u.output ?? 0,
      cacheRead: u.cacheRead ?? 0,
      cacheWrite: 0,
      turn: ctx.turn,
      provider: ctx.provider,
      model: ctx.model,
    };
  }
  // snake_case path (real OpenAI API response) — prompt_tokens INCLUDES
  // cached_tokens, so subtract to make `input` fresh-only (Anthropic
  // parity). The Math.max guard is defensive: cached > prompt shouldn't
  // happen but clamps to 0 if upstream ever drifts.
  const prompt = u.prompt_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input: Math.max(0, prompt - cached),
    output: u.completion_tokens ?? 0,
    cacheRead: cached,
    cacheWrite: 0,
    turn: ctx.turn,
    provider: ctx.provider,
    model: ctx.model,
  };
}
