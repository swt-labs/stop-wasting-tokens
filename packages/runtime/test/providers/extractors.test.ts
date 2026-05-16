import { describe, expect, it } from 'vitest';

import {
  extractAnthropic,
  extractGeneric,
  extractOpenAI,
  extractUsage,
} from '../../src/providers/extractors/index.js';

const CTX = { turn: 1, provider: 'anthropic', model: 'claude-sonnet-4-6' };

describe('@swt-labs/runtime — extractors/anthropic', () => {
  it('maps Anthropic native usage fields into TaskTokenUsage', () => {
    const out = extractAnthropic(
      {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 12,
      },
      CTX,
    );
    expect(out).toEqual({
      input: 100,
      output: 50,
      cacheRead: 30,
      cacheWrite: 12,
      turn: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('defaults missing cache fields to 0', () => {
    const out = extractAnthropic({ input_tokens: 5, output_tokens: 5 }, CTX);
    expect(out?.cacheRead).toBe(0);
    expect(out?.cacheWrite).toBe(0);
  });

  it('returns undefined when usage has no recognised fields', () => {
    expect(extractAnthropic({}, CTX)).toBeUndefined();
    expect(extractAnthropic(null, CTX)).toBeUndefined();
    expect(extractAnthropic('not an object', CTX)).toBeUndefined();
  });

  // alpha.21 — Pi `withUsageEstimate` shape (camelCase). Accepted as a
  // fallback when Pi's mock/estimate path supplies camelCase instead of
  // the snake_case Anthropic API shape. Pre-alpha.21 the extractor missed
  // this entirely and returned undefined → token accounting silently
  // zeroed for mock paths.
  it('alpha.21 — accepts Pi camelCase usage shape as fallback', () => {
    const out = extractAnthropic({ input: 100, output: 50, cacheRead: 30, cacheWrite: 12 }, CTX);
    expect(out).toEqual({
      input: 100,
      output: 50,
      cacheRead: 30,
      cacheWrite: 12,
      turn: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('alpha.21 — snake_case wins over camelCase when both present (real API > Pi estimate)', () => {
    const out = extractAnthropic(
      {
        // Real API numbers
        input_tokens: 100,
        output_tokens: 50,
        // Pi estimate — should be ignored when real numbers are present
        input: 9999,
        output: 9999,
      },
      CTX,
    );
    expect(out?.input).toBe(100);
    expect(out?.output).toBe(50);
  });
});

describe('@swt-labs/runtime — extractors/openai', () => {
  it('subtracts cached_tokens from prompt_tokens so `input` is fresh-only', () => {
    const out = extractOpenAI(
      {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 400 },
      },
      { ...CTX, provider: 'openai', model: 'gpt-5' },
    );
    expect(out?.input).toBe(600);
    expect(out?.cacheRead).toBe(400);
    expect(out?.output).toBe(200);
    expect(out?.cacheWrite).toBe(0);
  });

  it('handles no cache (cached_tokens missing) → all prompt is input', () => {
    const out = extractOpenAI(
      { prompt_tokens: 500, completion_tokens: 100 },
      { ...CTX, provider: 'openai', model: 'gpt-5' },
    );
    expect(out?.input).toBe(500);
    expect(out?.cacheRead).toBe(0);
  });

  it('returns undefined for non-OpenAI shapes', () => {
    expect(extractOpenAI({}, CTX)).toBeUndefined();
    expect(extractOpenAI(undefined, CTX)).toBeUndefined();
  });

  it("Math.max guard: if cached > prompt (shouldn't happen, but...) input clamps to 0", () => {
    const out = extractOpenAI(
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 200 },
      },
      CTX,
    );
    expect(out?.input).toBe(0);
  });

  // alpha.21 — Pi `withUsageEstimate` shape parity with the Anthropic
  // extractor. Same accept-both contract; same precedence (snake_case wins).
  it('alpha.21 — accepts Pi camelCase usage shape as fallback', () => {
    const out = extractOpenAI(
      { input: 600, output: 200, cacheRead: 400 },
      { ...CTX, provider: 'openai', model: 'gpt-5' },
    );
    // input is already fresh-prompt-only in the camelCase shape (Pi's
    // estimate excludes cache reads) — no extra subtraction needed.
    expect(out?.input).toBe(600);
    expect(out?.output).toBe(200);
    expect(out?.cacheRead).toBe(400);
  });
});

describe('@swt-labs/runtime — extractors/generic', () => {
  it('recognises camelCase variants (Ollama-style)', () => {
    const out = extractGeneric({ inputTokens: 50, outputTokens: 25 }, CTX);
    expect(out).toMatchObject({ input: 50, output: 25 });
  });

  it('recognises both Anthropic and OpenAI field names', () => {
    expect(extractGeneric({ input_tokens: 10, output_tokens: 5 }, CTX)?.input).toBe(10);
    expect(extractGeneric({ prompt_tokens: 10, completion_tokens: 5 }, CTX)?.input).toBe(10);
  });

  it('returns undefined when no recognised fields', () => {
    expect(extractGeneric({ random_field: 1 }, CTX)).toBeUndefined();
    expect(extractGeneric({}, CTX)).toBeUndefined();
  });
});

describe('@swt-labs/runtime — extractUsage dispatch', () => {
  it('dispatches anthropic provider name to anthropic extractor', () => {
    const out = extractUsage(
      'anthropic',
      { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 25 },
      CTX,
    );
    expect(out?.cacheRead).toBe(25); // anthropic-style cache field recognised
  });

  it('dispatches openai provider name to openai extractor (subtracts cached_tokens)', () => {
    const out = extractUsage(
      'openai',
      { prompt_tokens: 500, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 100 } },
      { ...CTX, provider: 'openai' },
    );
    expect(out?.input).toBe(400);
    expect(out?.cacheRead).toBe(100);
  });

  it('dispatches bedrock to anthropic (Claude family)', () => {
    const out = extractUsage(
      'bedrock',
      { input_tokens: 10, output_tokens: 5 },
      { ...CTX, provider: 'bedrock' },
    );
    expect(out?.input).toBe(10);
  });

  it('dispatches openrouter/anthropic/* to anthropic extractor', () => {
    const out = extractUsage(
      'openrouter/anthropic/claude-sonnet',
      { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
      { ...CTX, provider: 'openrouter/anthropic/claude-sonnet' },
    );
    expect(out?.cacheRead).toBe(2);
  });

  it('dispatches openrouter/openai/* to openai extractor', () => {
    const out = extractUsage(
      'openrouter/openai/gpt-5',
      { prompt_tokens: 9, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } },
      { ...CTX, provider: 'openrouter/openai/gpt-5' },
    );
    expect(out?.input).toBe(6);
    expect(out?.cacheRead).toBe(3);
  });

  it('falls back to generic for unknown providers', () => {
    const out = extractUsage(
      'ollama',
      { inputTokens: 20, outputTokens: 10 },
      { ...CTX, provider: 'ollama' },
    );
    expect(out?.input).toBe(20);
    expect(out?.output).toBe(10);
  });
});
