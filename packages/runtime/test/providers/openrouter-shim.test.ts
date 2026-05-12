/**
 * OpenRouter shim end-to-end validation per Plan 05-01 PR-39.
 *
 * OpenRouter routes through provider-prefixed model IDs:
 *   - `openrouter/anthropic/<model>` — Anthropic-shaped usage
 *   - `openrouter/openai/<model>` — OpenAI-shaped usage
 *   - `openrouter/<other-vendor>/<model>` — fall through to the generic
 *     extractor (best-effort)
 *
 * The infrastructure (quirks.json + default-tiers.json + extractUsage
 * dispatch) was wired at PR-08 + PR-07 era. PR-39 adds the end-to-end
 * validation suite that exercises:
 *   1. `extractUsage` routes provider-prefixed strings correctly.
 *   2. `resolveModelForRole({provider: 'openrouter', tier: 'balanced'})`
 *      returns the configured default.
 *   3. Round-trip through `createTokenMeter` + `computeCacheHitRatio`
 *      aggregates each underlying-shape correctly.
 *
 * No code changes — these tests are the regression guard that pins the
 * shim wire-up.
 */

import type { MeterRecord } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { computeCacheHitRatio } from '../../src/meter/cache-hit.js';
import { createTokenMeter } from '../../src/meter/token-meter.js';
import { extractUsage } from '../../src/providers/extractors/index.js';
import { resolveModelForRole } from '../../src/providers/role-resolver.js';

const ctx = (
  provider: string,
  model: string,
): { turn: number; provider: string; model: string } => ({
  turn: 1,
  provider,
  model,
});

describe('OpenRouter shim — extractUsage dispatch (M5 PR-39)', () => {
  it('routes openrouter/anthropic/* through extractAnthropic (cache fields preserved)', () => {
    const usage = {
      input_tokens: 1200,
      output_tokens: 200,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 100,
    };
    const out = extractUsage(
      'openrouter/anthropic/claude-opus-4-7',
      usage,
      ctx('openrouter/anthropic/claude-opus-4-7', 'claude-opus-4-7'),
    );
    expect(out).toBeDefined();
    expect(out?.input).toBe(1200);
    expect(out?.output).toBe(200);
    expect(out?.cacheRead).toBe(800);
    expect(out?.cacheWrite).toBe(100);
  });

  it('routes openrouter/openai/* through extractOpenAI (cached_tokens subtracted from input)', () => {
    const usage = {
      prompt_tokens: 1500,
      completion_tokens: 250,
      prompt_tokens_details: { cached_tokens: 1100 },
    };
    const out = extractUsage(
      'openrouter/openai/gpt-5',
      usage,
      ctx('openrouter/openai/gpt-5', 'gpt-5'),
    );
    expect(out).toBeDefined();
    // Anthropic-parity: input is fresh-only.
    expect(out?.input).toBe(400);
    expect(out?.output).toBe(250);
    expect(out?.cacheRead).toBe(1100);
    expect(out?.cacheWrite).toBe(0);
  });

  it('falls through to extractGeneric for openrouter/deepseek/* (non-Anthropic-non-OpenAI vendor)', () => {
    // DeepSeek-shaped usage isn't covered by Anthropic OR OpenAI keys
    // alone; the generic extractor recognises the broadest field-name
    // surface (prompt_tokens, completion_tokens, etc.).
    const usage = {
      prompt_tokens: 900,
      completion_tokens: 150,
    };
    const out = extractUsage(
      'openrouter/deepseek/deepseek-v3',
      usage,
      ctx('openrouter/deepseek/deepseek-v3', 'deepseek-v3'),
    );
    expect(out).toBeDefined();
    expect(out?.input).toBeGreaterThan(0);
    expect(out?.output).toBe(150);
  });

  it('dispatch is case-insensitive on the provider prefix', () => {
    const out = extractUsage(
      'OpenRouter/Anthropic/Claude-Opus-4-7',
      {
        input_tokens: 100,
        output_tokens: 10,
      },
      ctx('openrouter/anthropic/claude-opus-4-7', 'claude-opus-4-7'),
    );
    // Lowercasing happens in extractUsage; this routes to anthropic
    // extractor as expected.
    expect(out?.input).toBe(100);
    expect(out?.output).toBe(10);
  });
});

describe('OpenRouter shim — resolveModelForRole defaults (M5 PR-39)', () => {
  it('returns the default balanced model for openrouter (deepseek-v3 per default-tiers.json)', () => {
    const model = resolveModelForRole('dev', 'openrouter');
    expect(model).toBe('deepseek/deepseek-v3');
  });

  it('returns the default quality model for openrouter (anthropic/claude-opus-4-7)', () => {
    const model = resolveModelForRole('architect', 'openrouter');
    // Architect role defaults to 'quality' tier per DEFAULT_ROLE_TIERS.
    expect(model).toBe('anthropic/claude-opus-4-7');
  });

  it('returns the default cheap-fast model for openrouter (llama-3.2-3b-instruct:free)', () => {
    const model = resolveModelForRole('scout', 'openrouter');
    // Scout role defaults to 'cheap-fast' tier.
    expect(model).toBe('meta-llama/llama-3.2-3b-instruct:free');
  });

  it('returns the default reasoning model for openrouter (openai/o4)', () => {
    const model = resolveModelForRole('debugger', 'openrouter');
    // Debugger role defaults to 'reasoning' tier.
    expect(model).toBe('openai/o4');
  });
});

describe('OpenRouter shim — end-to-end through TokenMeter + computeCacheHitRatio (M5 PR-39)', () => {
  function recordUsage(
    meter: ReturnType<typeof createTokenMeter>,
    provider: string,
    model: string,
    usage: unknown,
  ): void {
    const extracted = extractUsage(provider, usage, { turn: 1, provider, model });
    if (extracted === undefined) return;
    const record: MeterRecord = {
      timestamp: '2026-05-12T10:00:00.000Z',
      milestone: 'M5',
      phase: '05',
      task_id: 'T-openrouter-test',
      role: 'dev',
      tier: 'balanced',
      provider: extracted.provider,
      model: extracted.model,
      turn: extracted.turn,
      input: extracted.input,
      output: extracted.output,
      cacheRead: extracted.cacheRead,
      cacheWrite: extracted.cacheWrite,
      cost_usd: 0,
    };
    meter.record(record, 0);
  }

  it('mixed OpenRouter providers aggregate as distinct cache-hit rows', () => {
    const meter = createTokenMeter();
    // Anthropic-shaped via OpenRouter — high cache read.
    recordUsage(meter, 'openrouter/anthropic/claude-opus-4-7', 'claude-opus-4-7', {
      input_tokens: 200,
      output_tokens: 50,
      cache_read_input_tokens: 1800,
      cache_creation_input_tokens: 100,
    });
    // OpenAI-shaped via OpenRouter — moderate cache hit.
    recordUsage(meter, 'openrouter/openai/gpt-5', 'gpt-5', {
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 600 },
    });

    const ratios = computeCacheHitRatio(meter.snapshot());
    expect(ratios.map((r) => r.provider).sort()).toEqual([
      'openrouter/anthropic/claude-opus-4-7',
      'openrouter/openai/gpt-5',
    ]);
    const anthropicRow = ratios.find((r) => r.provider === 'openrouter/anthropic/claude-opus-4-7');
    const openaiRow = ratios.find((r) => r.provider === 'openrouter/openai/gpt-5');
    // Anthropic row: 1800 / (1800 + 100 + 200) = 0.857
    expect(anthropicRow?.ratio).toBeCloseTo(0.857, 2);
    // OpenAI row: 600 / (600 + 0 + 400) = 0.6
    expect(openaiRow?.ratio).toBeCloseTo(0.6);
  });
});
