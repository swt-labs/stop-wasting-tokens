import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import quirksJson from '../../src/providers/quirks.json' with { type: 'json' };

/**
 * Validates `providers/quirks.json` structure. The CRITICAL invariant: every
 * `thinkingLevelMap`'s KEYS are Pi `ThinkingLevel` values
 * (off|minimal|low|medium|high|xhigh), NOT SWT tier names. This was the bug
 * TDD2 originally had that the M1 plans audit caught (Plan 01-01 audit, gap G-?).
 *
 * If a future contributor accidentally writes a tier name as a thinkingLevelMap
 * key (e.g., `"balanced": "low"`), this test fails and the merge blocks.
 */

const VALID_THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const FORBIDDEN_KEYS_THAT_LOOK_LIKE_TIERS = new Set([
  'cheap-fast',
  'balanced',
  'quality',
  'reasoning',
]);

const ProviderQuirkSchema = z.object({
  models: z
    .record(
      z.string(),
      z.object({
        thinkingLevelMap: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
        compat: z
          .object({
            thinkingFormat: z.string().optional(),
            maxTokensField: z.string().optional(),
            supportsDeveloperRole: z.boolean().optional(),
            supportsReasoningEffort: z.boolean().optional(),
            supportsLongCacheRetention: z.boolean().optional(),
            streamSimple: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  compat: z
    .object({
      supportsLongCacheRetention: z.boolean().optional(),
    })
    .optional(),
});

describe('@swt-labs/runtime — quirks.json structure', () => {
  const quirks = quirksJson as Record<string, unknown>;

  it('parses with the Zod provider-quirk schema (every provider entry)', () => {
    for (const [name, entry] of Object.entries(quirks)) {
      if (name.startsWith('_')) continue; // skip _comment metadata
      expect(() => ProviderQuirkSchema.parse(entry), `${name} should parse`).not.toThrow();
    }
  });

  it('CRITICAL: every thinkingLevelMap key is a Pi ThinkingLevel value, NOT a SWT tier name', () => {
    for (const [providerName, entry] of Object.entries(quirks)) {
      if (providerName.startsWith('_')) continue;
      const parsed = ProviderQuirkSchema.parse(entry);
      if (!parsed.models) continue;
      for (const [modelGlob, modelOverrides] of Object.entries(parsed.models)) {
        if (!modelOverrides.thinkingLevelMap) continue;
        const keys = Object.keys(modelOverrides.thinkingLevelMap);
        for (const key of keys) {
          expect(
            VALID_THINKING_LEVELS.has(key),
            `${providerName}.${modelGlob}.thinkingLevelMap key "${key}" must be a Pi ThinkingLevel (one of ${[...VALID_THINKING_LEVELS].join(', ')}), not a SWT tier name`,
          ).toBe(true);
          expect(
            FORBIDDEN_KEYS_THAT_LOOK_LIKE_TIERS.has(key),
            `${providerName}.${modelGlob}.thinkingLevelMap key "${key}" looks like a SWT tier name (forbidden — TDD2 regression check)`,
          ).toBe(false);
        }
      }
    }
  });

  it('includes the 4 providers that M1..M5 exercise: anthropic, openai, openrouter, google', () => {
    expect(quirks).toHaveProperty('anthropic');
    expect(quirks).toHaveProperty('openai');
    expect(quirks).toHaveProperty('openrouter');
    expect(quirks).toHaveProperty('google');
  });

  it('anthropic compat reports supportsLongCacheRetention: true (ADR-004 territory)', () => {
    const ant = quirks['anthropic'] as { compat?: { supportsLongCacheRetention?: boolean } };
    expect(ant.compat?.supportsLongCacheRetention).toBe(true);
  });

  it('openai gpt-5* model entry sets maxTokensField to max_completion_tokens', () => {
    const oa = quirks['openai'] as {
      models?: Record<string, { compat?: { maxTokensField?: string } }>;
    };
    expect(oa.models?.['gpt-5*']?.compat?.maxTokensField).toBe('max_completion_tokens');
  });
});
