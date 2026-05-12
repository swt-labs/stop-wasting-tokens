/**
 * Anthropic `cache_control` breakpoint insertion per ADR-006 + TDD2 §8.2.1 +
 * Plan 04-01 PR-32.
 *
 * The orchestration layer's `buildPrompt` (PR-12, polished in PR-31) emits
 * an ordered array of `PromptBlock`s + a `cacheBreakpointIndex` separating
 * the stable prefix (blocks 0..N-1) from the variable suffix (blocks N..M).
 * This module is the wire-side consumer: it converts a `BuiltPrompt`-shaped
 * input into a Pi-bound message array with `cache_control: {type:
 * 'ephemeral'}` attached to the LAST block before the breakpoint (per
 * ADR-006 — Anthropic caches everything up to and including the marker).
 *
 * **Anthropic-only.** OpenAI auto-caches the prefix when ≥1024 tokens; no
 * `cache_control` marker is needed. Other providers ignore the field. The
 * function still produces a valid wire payload — just without the marker.
 *
 * **Block-size guard (1024-token minimum).** Anthropic's cache requires
 * ≥1024 tokens in the cacheable prefix. Below that, caching is a no-op
 * AND a tiny prefix means an upstream cassette test would record cache
 * misses. We approximate token count via `chars / 4` (Anthropic's
 * documented rule-of-thumb; cassette-replay token counts are the exact
 * source of truth, but at request-time we only have characters). If the
 * estimate falls below the minimum, the marker is omitted and the result
 * carries `skipReason: 'prefix-too-small'` for telemetry.
 *
 * Per Principle 1 (TDD2 §4.3): this is `packages/runtime/`, the only
 * layer that knows about provider-specific wire formats. The orchestration
 * layer hands a vendor-neutral `BuiltPrompt`; this module produces the
 * Anthropic-shaped messages.
 */

/**
 * Structural prompt-block shape. The orchestration layer's `buildPrompt`
 * returns `BuiltPrompt.blocks` matching this structure; this module
 * accepts the structural shape directly so the runtime layer doesn't
 * depend on `@swt-labs/orchestration` (Principle 2 — runtime is below
 * orchestration in the layer stack).
 */
export interface PromptBlockLike {
  readonly kind: string;
  readonly content: string;
}

/** Anthropic's documented minimum tokens-per-breakpoint. */
export const ANTHROPIC_CACHE_MIN_TOKENS = 1024;

/**
 * Approximate chars-per-token for English-leaning prompts. Anthropic
 * publishes this as a rule-of-thumb for sizing prompts before tokenizing.
 * Used by `estimatePromptTokens` for the request-time block-size guard.
 */
export const APPROX_CHARS_PER_TOKEN = 4;

export type CacheSkipReason =
  | 'prefix-too-small'
  | 'no-blocks-before-breakpoint'
  | 'provider-not-anthropic';

export interface CacheControlInput {
  /** Ordered blocks from `BuiltPrompt.blocks`. */
  readonly blocks: ReadonlyArray<PromptBlockLike>;
  /** Index from `BuiltPrompt.cacheBreakpointIndex`. */
  readonly cacheBreakpointIndex: number;
  /** Provider id (e.g., `'anthropic'`, `'openai'`, `'openrouter'`). */
  readonly provider: string;
}

/**
 * Anthropic-shaped message: `{type: 'text', text: ...}` with an optional
 * `cache_control` marker. Pi's `appendUserMessage` accepts this shape
 * verbatim for Anthropic.
 */
export interface AnthropicMessage {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: { readonly type: 'ephemeral' };
}

export interface CacheControlResult {
  /** Pi-bound message array, ready for `agentSession.prompt(messages)`. */
  readonly messages: ReadonlyArray<AnthropicMessage>;
  /** True when the `cache_control` marker was applied. */
  readonly breakpointApplied: boolean;
  /** When `breakpointApplied === false`, the structured reason. */
  readonly skipReason?: CacheSkipReason;
  /** Estimated token count of the prefix (the cacheable region). */
  readonly estimatedPrefixTokens: number;
}

/**
 * Build the Pi-bound message array, threading `cache_control:
 * {type: 'ephemeral'}` onto the last block before the breakpoint when
 * the provider is Anthropic and the prefix meets the size minimum.
 *
 * Always returns a valid `messages` array — the only field that varies
 * is whether the marker is attached. Callers that need cache-skip
 * telemetry can inspect `breakpointApplied` + `skipReason`.
 */
export function applyCacheControl(input: CacheControlInput): CacheControlResult {
  const prefixContent = input.blocks
    .slice(0, input.cacheBreakpointIndex)
    .map((b) => b.content)
    .join('\n\n');
  const estimatedPrefixTokens = estimatePromptTokens(prefixContent);

  const messagesWithoutMarker: ReadonlyArray<AnthropicMessage> = input.blocks.map((b) => ({
    type: 'text',
    text: b.content,
  }));

  if (input.provider !== 'anthropic') {
    return {
      messages: messagesWithoutMarker,
      breakpointApplied: false,
      skipReason: 'provider-not-anthropic',
      estimatedPrefixTokens,
    };
  }

  if (input.cacheBreakpointIndex <= 0) {
    return {
      messages: messagesWithoutMarker,
      breakpointApplied: false,
      skipReason: 'no-blocks-before-breakpoint',
      estimatedPrefixTokens,
    };
  }

  if (estimatedPrefixTokens < ANTHROPIC_CACHE_MIN_TOKENS) {
    return {
      messages: messagesWithoutMarker,
      breakpointApplied: false,
      skipReason: 'prefix-too-small',
      estimatedPrefixTokens,
    };
  }

  const messages: AnthropicMessage[] = input.blocks.map((b, i) => {
    if (i === input.cacheBreakpointIndex - 1) {
      return {
        type: 'text',
        text: b.content,
        cache_control: { type: 'ephemeral' },
      };
    }
    return { type: 'text', text: b.content };
  });

  return {
    messages,
    breakpointApplied: true,
    estimatedPrefixTokens,
  };
}

/**
 * Char-based token estimate for the request-time block-size guard.
 * Anthropic publishes ~4 chars/token as a rule-of-thumb; we round up
 * so a prefix that's right at the boundary doesn't get rejected for
 * being one estimate-token short.
 */
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}
