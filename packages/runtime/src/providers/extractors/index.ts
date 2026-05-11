/**
 * Provider-specific usage extractor registry.
 *
 * `extractUsage(provider, usage, ctx)` dispatches on the provider id and
 * returns a vendor-neutral `TaskTokenUsage` shape. The event mapper in
 * `runtime/src/events.ts` calls this on Pi `turn_end` events to populate
 * `SwtEvent.TASK_TOKEN_USAGE.usage`.
 *
 * Dispatch rules:
 *   - `anthropic`, `bedrock` (Claude family) → `extractAnthropic`
 *   - `openai` (including `gpt-5*`, `o4`) → `extractOpenAI`
 *   - `openrouter/anthropic/*` → `extractAnthropic` (Anthropic-shaped usage)
 *   - `openrouter/openai/*` → `extractOpenAI` (OpenAI-shaped usage)
 *   - anything else → `extractGeneric` (best-effort)
 */

import type { TaskTokenUsage } from '@swt-labs/shared';

import { extractAnthropic } from './anthropic.js';
import { extractGeneric } from './generic.js';
import { extractOpenAI } from './openai.js';

export interface ExtractContext {
  readonly turn: number;
  readonly provider: string;
  readonly model: string;
}

export function extractUsage(
  provider: string,
  usage: unknown,
  ctx: ExtractContext,
): TaskTokenUsage | undefined {
  const p = provider.toLowerCase();
  if (p === 'anthropic' || p === 'bedrock' || p.startsWith('openrouter/anthropic')) {
    return extractAnthropic(usage, ctx);
  }
  if (p === 'openai' || p.startsWith('openrouter/openai')) {
    return extractOpenAI(usage, ctx);
  }
  return extractGeneric(usage, ctx);
}

export { extractAnthropic } from './anthropic.js';
export { extractOpenAI } from './openai.js';
export { extractGeneric } from './generic.js';
