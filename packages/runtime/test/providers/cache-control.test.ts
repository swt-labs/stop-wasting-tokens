/**
 * `applyCacheControl` Anthropic `cache_control` breakpoint tests per
 * ADR-006 + Plan 04-01 PR-32.
 *
 * Asserts:
 *   1. Anthropic + large-enough prefix → marker attached to the LAST
 *      block before the breakpoint; subsequent blocks pass through
 *      unmarked.
 *   2. Prefix below the 1024-token estimate → marker omitted +
 *      `skipReason: 'prefix-too-small'`.
 *   3. Non-Anthropic providers → marker omitted + `skipReason:
 *      'provider-not-anthropic'`. Messages still produced correctly.
 *   4. Empty prefix (`cacheBreakpointIndex === 0`) → marker omitted +
 *      `skipReason: 'no-blocks-before-breakpoint'`.
 *   5. `estimatePromptTokens` produces the documented chars/4 rounded
 *      up; boundary cases (length 0, length 1, length 1024*4).
 *   6. Returned `messages` array always has the same length as
 *      `input.blocks`.
 */

import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_CACHE_MIN_TOKENS,
  APPROX_CHARS_PER_TOKEN,
  applyCacheControl,
  estimatePromptTokens,
  type CacheControlInput,
} from '../../src/providers/cache-control.js';

/** Build a block whose content is `targetChars` chars of `x`. */
function bigBlock(kind: string, targetChars: number): { kind: string; content: string } {
  return { kind, content: 'x'.repeat(targetChars) };
}

/** Build a canonical input with `prefixChars` total chars across `prefixBlocks` cacheable blocks + 2 suffix blocks. */
function inputWithPrefixSize(opts: {
  prefixBlocks: number;
  prefixChars: number;
  provider: string;
}): CacheControlInput {
  const blocks: ReadonlyArray<{ kind: string; content: string }> = [
    ...Array.from({ length: opts.prefixBlocks }, (_, i) =>
      bigBlock(`prefix-${i}`, Math.ceil(opts.prefixChars / opts.prefixBlocks)),
    ),
    { kind: 'task', content: 'do the thing' },
    { kind: 'must-haves', content: '- mh-1: done' },
  ];
  return {
    blocks,
    cacheBreakpointIndex: opts.prefixBlocks,
    provider: opts.provider,
  };
}

describe('applyCacheControl — Anthropic happy path (M4 PR-32)', () => {
  it('attaches cache_control to the LAST block before the breakpoint when prefix is large enough', () => {
    // 5000 chars / 4 = 1250 estimated tokens, comfortably over the 1024 min.
    const input = inputWithPrefixSize({
      prefixBlocks: 3,
      prefixChars: 5000,
      provider: 'anthropic',
    });
    const result = applyCacheControl(input);

    expect(result.breakpointApplied).toBe(true);
    expect(result.skipReason).toBeUndefined();
    expect(result.messages).toHaveLength(input.blocks.length);

    // Marker on block[2] (last block before breakpoint at index 3).
    expect(result.messages[2]?.cache_control).toEqual({ type: 'ephemeral' });
    // Blocks 0, 1 (prefix interior), 3, 4 (suffix) have NO marker.
    expect(result.messages[0]?.cache_control).toBeUndefined();
    expect(result.messages[1]?.cache_control).toBeUndefined();
    expect(result.messages[3]?.cache_control).toBeUndefined();
    expect(result.messages[4]?.cache_control).toBeUndefined();

    // Estimated tokens reported back accurately.
    expect(result.estimatedPrefixTokens).toBeGreaterThanOrEqual(ANTHROPIC_CACHE_MIN_TOKENS);
  });

  it('preserves block content verbatim (no truncation, no re-ordering)', () => {
    const input = inputWithPrefixSize({
      prefixBlocks: 2,
      prefixChars: 4500,
      provider: 'anthropic',
    });
    const result = applyCacheControl(input);
    for (let i = 0; i < input.blocks.length; i++) {
      expect(result.messages[i]?.text).toBe(input.blocks[i]?.content);
      expect(result.messages[i]?.type).toBe('text');
    }
  });
});

describe('applyCacheControl — skip cases (M4 PR-32)', () => {
  it("omits marker and reports 'prefix-too-small' when prefix < 1024 estimated tokens", () => {
    // 100 chars / 4 = 25 estimated tokens — way below the cap.
    const input = inputWithPrefixSize({
      prefixBlocks: 2,
      prefixChars: 100,
      provider: 'anthropic',
    });
    const result = applyCacheControl(input);

    expect(result.breakpointApplied).toBe(false);
    expect(result.skipReason).toBe('prefix-too-small');
    expect(result.estimatedPrefixTokens).toBeLessThan(ANTHROPIC_CACHE_MIN_TOKENS);
    // Every message has no marker — the array is still valid wire payload.
    for (const m of result.messages) {
      expect(m.cache_control).toBeUndefined();
    }
  });

  it("omits marker and reports 'provider-not-anthropic' for OpenAI", () => {
    const input = inputWithPrefixSize({
      prefixBlocks: 3,
      prefixChars: 5000, // big enough; the skip is about the provider, not the size
      provider: 'openai',
    });
    const result = applyCacheControl(input);

    expect(result.breakpointApplied).toBe(false);
    expect(result.skipReason).toBe('provider-not-anthropic');
    expect(result.messages).toHaveLength(input.blocks.length);
    for (const m of result.messages) {
      expect(m.cache_control).toBeUndefined();
    }
  });

  it("omits marker and reports 'no-blocks-before-breakpoint' when cacheBreakpointIndex is 0", () => {
    const input: CacheControlInput = {
      blocks: [
        { kind: 'task', content: 'go' },
        { kind: 'must-haves', content: '- mh' },
      ],
      cacheBreakpointIndex: 0,
      provider: 'anthropic',
    };
    const result = applyCacheControl(input);

    expect(result.breakpointApplied).toBe(false);
    expect(result.skipReason).toBe('no-blocks-before-breakpoint');
    expect(result.estimatedPrefixTokens).toBe(0);
  });

  it('handles non-anthropic providers without crashing on empty blocks', () => {
    const result = applyCacheControl({
      blocks: [],
      cacheBreakpointIndex: 0,
      provider: 'openrouter',
    });
    expect(result.messages).toEqual([]);
    expect(result.breakpointApplied).toBe(false);
    expect(result.skipReason).toBe('provider-not-anthropic');
  });
});

describe('estimatePromptTokens — chars/4 rounded up (M4 PR-32)', () => {
  it('returns 0 for empty string', () => {
    expect(estimatePromptTokens('')).toBe(0);
  });

  it('returns 1 for length 1..4 (chars/4 rounded up)', () => {
    expect(estimatePromptTokens('a')).toBe(1);
    expect(estimatePromptTokens('abcd')).toBe(1);
  });

  it('returns 2 for length 5..8 (rounded up)', () => {
    expect(estimatePromptTokens('abcde')).toBe(2);
    expect(estimatePromptTokens('abcdefgh')).toBe(2);
  });

  it('returns exactly 1024 at the cap boundary', () => {
    const text = 'x'.repeat(ANTHROPIC_CACHE_MIN_TOKENS * APPROX_CHARS_PER_TOKEN);
    expect(estimatePromptTokens(text)).toBe(ANTHROPIC_CACHE_MIN_TOKENS);
  });
});

describe('applyCacheControl — exact-cap boundary (M4 PR-32)', () => {
  it('exactly at the 1024-token estimate boundary applies the marker', () => {
    // chars = 1024 * 4 = 4096 → estimate = 1024. >= cap, so marker fires.
    const prefixChars = ANTHROPIC_CACHE_MIN_TOKENS * APPROX_CHARS_PER_TOKEN;
    const input = inputWithPrefixSize({
      prefixBlocks: 1,
      prefixChars,
      provider: 'anthropic',
    });
    const result = applyCacheControl(input);
    expect(result.breakpointApplied).toBe(true);
    expect(result.estimatedPrefixTokens).toBe(ANTHROPIC_CACHE_MIN_TOKENS);
  });

  it('4 chars below the boundary (one estimate-token short) skips the marker', () => {
    // Token estimate is `Math.ceil(chars / 4)`. To land at 1023 (below the
    // 1024 minimum), we need chars where ceil(chars/4) === 1023 → chars in
    // [4089..4092]. Use 4092 (exact multiple of 4 → 1023 tokens flat).
    const prefixChars = (ANTHROPIC_CACHE_MIN_TOKENS - 1) * APPROX_CHARS_PER_TOKEN;
    const input = inputWithPrefixSize({
      prefixBlocks: 1,
      prefixChars,
      provider: 'anthropic',
    });
    const result = applyCacheControl(input);
    expect(result.breakpointApplied).toBe(false);
    expect(result.skipReason).toBe('prefix-too-small');
    expect(result.estimatedPrefixTokens).toBe(ANTHROPIC_CACHE_MIN_TOKENS - 1);
  });
});
