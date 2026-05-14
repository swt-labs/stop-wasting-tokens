/**
 * Phase 3 / Plan 03-01 T4 (G-R4) — projectSpawnCost + estimateTokens unit tests.
 *
 * Pins the pure cost-projector contract:
 *
 *   1. estimateTokens — char/4 heuristic; `Math.ceil(len/4)`; `'' -> 0`.
 *   2. Known prompt -> known token count — fixed input -> hand-computed
 *      `projected_input_tokens`.
 *   3. Provider hit — `anthropic` resolves the anthropic fixture entry;
 *      `projected_cost_usd` matches the hand-computed cold formula;
 *      `confidence === 'medium'`.
 *   4. Provider miss -> fallback + low — `ollama` (absent) falls back to the
 *      first anthropic entry; `confidence === 'low'`; the provider-miss
 *      assumption string is present.
 *   5. Cold vs warm — `assumeWarmPrefix` against an entry WITH `cache_read_per_1k`
 *      (warm < cold) vs an entry WITHOUT cache fields (warm === cold).
 *   6. Worst-case vs expected — `projected_cost_usd >= expected_cost_usd`;
 *      `projected_output_tokens === maxTurns * outputTokensPerTurn`.
 *   7. maxTurns: 0 — `projected_output_tokens === 0`; `projected_cost_usd`
 *      finite + > 0 (input-only).
 *   8. Assumptions cap — `assumptions.length <= 8`; every string `length <= 80`.
 *
 * Fixtures are inline `RateCard` objects (no fs) — mirrors the fixture style
 * in `rate-card-source.test.ts`.
 */

import type { RateCard } from '@swt-labs/shared';
import { describe, expect, test } from 'vitest';

import {
  CHARS_PER_TOKEN,
  DEFAULT_OUTPUT_TOKENS_PER_TURN,
  estimateTokens,
  projectSpawnCost,
  type SpawnProjectionInput,
} from '../../src/budget/cost-projector.js';

/**
 * Inline fixture card: an `anthropic` entry WITH `cache_read_per_1k` and an
 * `openai` entry WITHOUT cache fields (per the schema doc — only Anthropic
 * publishes a distinct cache rate).
 */
const FIXTURE_CARD: RateCard = {
  schema_version: 1,
  source: 'embedded',
  generated_at: '2026-05-01T00:00:00.000Z',
  entries: [
    {
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      input_per_1k: 0.015,
      output_per_1k: 0.075,
      cache_read_per_1k: 0.0015,
      updated_at: '2026-05-01T00:00:00.000Z',
    },
    {
      provider: 'openai',
      model: 'gpt-5',
      input_per_1k: 0.01,
      output_per_1k: 0.03,
      updated_at: '2026-05-01T00:00:00.000Z',
    },
  ],
};

/** A 400-char system prompt -> 100 tokens; 200-char task prompt -> 50 tokens. */
const BASE_INPUT: SpawnProjectionInput = {
  systemPrompt: 'x'.repeat(400),
  taskPrompt: 'y'.repeat(200),
  maxTurns: 10,
  provider: 'anthropic',
};

describe('estimateTokens — char/4 heuristic', () => {
  test('a frozen string of known length yields Math.ceil(len/4)', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    const frozen = 'a'.repeat(401);
    expect(estimateTokens(frozen)).toBe(Math.ceil(401 / 4));
  });

  test('estimateTokens("") === 0', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('projectSpawnCost — token projection', () => {
  test('known prompt -> known token count (hand-computed ceil(len/4) sum)', () => {
    const projection = projectSpawnCost(BASE_INPUT, FIXTURE_CARD);
    // 400 chars -> 100 tok; 200 chars -> 50 tok; sum = 150.
    expect(projection.projected_input_tokens).toBe(150);
    expect(projection.projected_input_tokens).toBe(
      estimateTokens(BASE_INPUT.systemPrompt) + estimateTokens(BASE_INPUT.taskPrompt),
    );
  });

  test('worst-case output is maxTurns * outputTokensPerTurn; >= expected', () => {
    const projection = projectSpawnCost(BASE_INPUT, FIXTURE_CARD);
    expect(projection.projected_output_tokens).toBe(
      BASE_INPUT.maxTurns * DEFAULT_OUTPUT_TOKENS_PER_TURN,
    );
    expect(projection.expected_cost_usd).toBeDefined();
    expect(projection.projected_cost_usd).toBeGreaterThanOrEqual(
      projection.expected_cost_usd as number,
    );
  });

  test('maxTurns: 0 yields 0 output tokens + a finite input-only cost', () => {
    const projection = projectSpawnCost({ ...BASE_INPUT, maxTurns: 0 }, FIXTURE_CARD);
    expect(projection.projected_output_tokens).toBe(0);
    expect(Number.isFinite(projection.projected_cost_usd)).toBe(true);
    expect(projection.projected_cost_usd).toBeGreaterThan(0);
  });
});

describe('projectSpawnCost — rate-card pricing', () => {
  test('provider hit resolves the anthropic entry; cold cost matches the formula', () => {
    const projection = projectSpawnCost(BASE_INPUT, FIXTURE_CARD);
    // Cold: (150/1000)*0.015 + (8000/1000)*0.075 = 0.00225 + 0.6 = 0.60225
    const expectedCold = (150 / 1000) * 0.015 + (8000 / 1000) * 0.075;
    expect(projection.projected_cost_usd).toBeCloseTo(expectedCold, 10);
    expect(projection.confidence).toBe('medium');
    expect(projection.rate_card_source).toBe('embedded');
  });

  test('provider miss falls back to the first anthropic entry + low confidence', () => {
    const projection = projectSpawnCost({ ...BASE_INPUT, provider: 'ollama' }, FIXTURE_CARD);
    expect(projection.confidence).toBe('low');
    // Fallback prices against the anthropic entry — same cold cost as a hit.
    const expectedCold = (150 / 1000) * 0.015 + (8000 / 1000) * 0.075;
    expect(projection.projected_cost_usd).toBeCloseTo(expectedCold, 10);
    expect(projection.assumptions.some((a) => a.includes('not in rate card'))).toBe(true);
    expect(projection.assumptions.some((a) => a.includes("provider 'ollama'"))).toBe(true);
  });

  test('cold vs warm — warm < cold for an entry WITH cache_read_per_1k', () => {
    const cold = projectSpawnCost(BASE_INPUT, FIXTURE_CARD, {
      assumeWarmPrefix: false,
    });
    const warm = projectSpawnCost(BASE_INPUT, FIXTURE_CARD, {
      assumeWarmPrefix: true,
    });
    expect(warm.projected_cost_usd).toBeLessThan(cold.projected_cost_usd);
    expect(warm.assumptions.some((a) => a.includes('warm prefix assumed'))).toBe(true);
  });

  test('cold vs warm — warm === cold for an entry WITHOUT cache fields', () => {
    const openaiInput: SpawnProjectionInput = {
      ...BASE_INPUT,
      provider: 'openai',
    };
    const cold = projectSpawnCost(openaiInput, FIXTURE_CARD, {
      assumeWarmPrefix: false,
    });
    const warm = projectSpawnCost(openaiInput, FIXTURE_CARD, {
      assumeWarmPrefix: true,
    });
    expect(warm.projected_cost_usd).toBe(cold.projected_cost_usd);
  });
});

describe('projectSpawnCost — assumptions honesty surface', () => {
  test('assumptions array is <= 8 entries and every string <= 80 chars', () => {
    // The provider-miss path produces the most assumptions (5); a long
    // provider name exercises the per-string hard-truncation.
    const projection = projectSpawnCost(
      { ...BASE_INPUT, provider: 'some-very-long-unknown-provider-name' },
      FIXTURE_CARD,
    );
    expect(projection.assumptions.length).toBe(5);
    expect(projection.assumptions.length).toBeLessThanOrEqual(8);
    for (const assumption of projection.assumptions) {
      expect(assumption.length).toBeLessThanOrEqual(80);
    }
    // The always-present notes come first.
    expect(projection.assumptions[0]).toBe('input estimated via char/4 heuristic');
  });
});
