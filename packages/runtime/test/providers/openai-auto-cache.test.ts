/**
 * OpenAI auto-cache observation per Plan 04-01 PR-34.
 *
 * OpenAI auto-caches prompts ≥1024 tokens without requiring an explicit
 * `cache_control` marker (the way Anthropic does — see PR-32). The
 * `prompt_tokens_details.cached_tokens` field on `usage` is the
 * observability signal. This test pins the end-to-end contract:
 *
 *   1. `extractOpenAI` reads `prompt_tokens_details.cached_tokens` and
 *      routes it to the `TaskTokenUsage.cacheRead` field.
 *   2. The `input` field reports fresh-prompt tokens only (parity with
 *      Anthropic's `input_tokens` semantics — cache_read is excluded).
 *   3. `cacheWrite` is always 0 for OpenAI (no cache-write dimension at
 *      the API surface).
 *   4. The full auto-cache flow — record cached_tokens to the meter →
 *      `computeCacheHitRatio` produces the correct ratio for OpenAI
 *      with no `cache_control` wiring on the request side.
 *
 * The extractor itself was written in PR-07 era; PR-34 verifies the
 * auto-cache contract holds + adds end-to-end integration coverage
 * with the cache-hit aggregator (M4 EXIT GATE prerequisite).
 */

import type { MeterRecord } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { computeCacheHitRatio } from '../../src/meter/cache-hit.js';
import { createTokenMeter } from '../../src/meter/token-meter.js';
import { extractOpenAI } from '../../src/providers/extractors/openai.js';

const CTX = { turn: 1, provider: 'openai', model: 'gpt-5' };

describe('OpenAI auto-cache observation (M4 PR-34)', () => {
  it('routes prompt_tokens_details.cached_tokens to TaskTokenUsage.cacheRead', () => {
    const out = extractOpenAI(
      {
        prompt_tokens: 5500,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 5000 },
      },
      CTX,
    );
    expect(out).toBeDefined();
    expect(out?.cacheRead).toBe(5000);
    // Anthropic parity: input = prompt - cached (fresh-only).
    expect(out?.input).toBe(500);
    expect(out?.output).toBe(200);
    // OpenAI exposes no cache-write dimension.
    expect(out?.cacheWrite).toBe(0);
  });

  it('handles fully-cached prompt (cached_tokens === prompt_tokens) — input = 0', () => {
    const out = extractOpenAI(
      {
        prompt_tokens: 4000,
        completion_tokens: 150,
        prompt_tokens_details: { cached_tokens: 4000 },
      },
      CTX,
    );
    expect(out?.cacheRead).toBe(4000);
    expect(out?.input).toBe(0);
    expect(out?.output).toBe(150);
  });

  it('handles below-auto-cache-minimum prompts (cached_tokens === 0) cleanly', () => {
    // OpenAI auto-caches ≥1024 tokens; smaller prompts have cached_tokens: 0
    // (or omit the field). Extractor must still produce a valid usage row.
    const out = extractOpenAI(
      {
        prompt_tokens: 800,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 0 },
      },
      CTX,
    );
    expect(out?.cacheRead).toBe(0);
    expect(out?.input).toBe(800);
    expect(out?.output).toBe(50);
  });

  it('treats a missing prompt_tokens_details as zero cache reads', () => {
    const out = extractOpenAI(
      { prompt_tokens: 1500, completion_tokens: 100 }, // no prompt_tokens_details
      CTX,
    );
    expect(out?.cacheRead).toBe(0);
    expect(out?.input).toBe(1500);
  });
});

describe('OpenAI auto-cache end-to-end with TokenMeter + computeCacheHitRatio (M4 PR-34)', () => {
  function recordTurn(
    meter: ReturnType<typeof createTokenMeter>,
    usage: ReturnType<typeof extractOpenAI>,
    overrides: Partial<MeterRecord> = {},
  ): void {
    if (usage === undefined) throw new Error('extractor returned undefined');
    meter.record(
      {
        timestamp: '2026-05-12T10:00:00.000Z',
        milestone: 'M4',
        phase: '04',
        task_id: 'T-openai-auto-cache',
        role: 'dev',
        tier: 'balanced',
        provider: usage.provider,
        model: usage.model,
        turn: usage.turn,
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        ...overrides,
      },
      0, // costUsd; per-test irrelevant
    );
  }

  it('a sequence of OpenAI turns aggregates cacheRead correctly through the full pipeline', () => {
    const meter = createTokenMeter();

    // Turn 1: cold prompt, no cache.
    recordTurn(
      meter,
      extractOpenAI(
        { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 0 } },
        { ...CTX, turn: 1 },
      ),
    );

    // Turn 2: same prefix → most of the prompt is cached.
    recordTurn(
      meter,
      extractOpenAI(
        {
          prompt_tokens: 1300,
          completion_tokens: 95,
          prompt_tokens_details: { cached_tokens: 1100 },
        },
        { ...CTX, turn: 2 },
      ),
    );

    // Turn 3: same prefix again → full cache hit on the prefix.
    recordTurn(
      meter,
      extractOpenAI(
        {
          prompt_tokens: 1400,
          completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 1200 },
        },
        { ...CTX, turn: 3 },
      ),
    );

    const summary = computeCacheHitRatio(meter.snapshot());
    expect(summary).toHaveLength(1);
    expect(summary[0]?.provider).toBe('openai');
    // cacheRead totals: 0 + 1100 + 1200 = 2300
    expect(summary[0]?.cacheRead).toBe(2300);
    // input totals: 1200 + (1300-1100=200) + (1400-1200=200) = 1600
    expect(summary[0]?.input).toBe(1600);
    // No cache-write dimension for OpenAI.
    expect(summary[0]?.cacheWrite).toBe(0);
    // ratio = 2300 / (2300 + 0 + 1600) = 0.5897…
    expect(summary[0]?.ratio).toBeCloseTo(2300 / 3900);
  });

  it('a sustained-cache run hits the ≥70% M4 EXIT GATE target', () => {
    const meter = createTokenMeter();
    // First turn: cold; subsequent turns: 90% prefix cache hit (steady-state
    // pattern for a long-running agent with stable PROJECT.md + STATE.md).
    recordTurn(
      meter,
      extractOpenAI(
        {
          prompt_tokens: 2000,
          completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 0 },
        },
        { ...CTX, turn: 1 },
      ),
    );
    for (let i = 2; i <= 10; i++) {
      recordTurn(
        meter,
        extractOpenAI(
          {
            prompt_tokens: 2100,
            completion_tokens: 100,
            prompt_tokens_details: { cached_tokens: 1900 }, // ~90% of prompt cached
          },
          { ...CTX, turn: i },
        ),
      );
    }

    const summary = computeCacheHitRatio(meter.snapshot());
    expect(summary).toHaveLength(1);
    expect(summary[0]?.ratio).toBeGreaterThanOrEqual(0.7);
  });
});
