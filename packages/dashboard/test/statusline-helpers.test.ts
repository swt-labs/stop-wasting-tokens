/**
 * `statusline-helpers` — Statusline-extension milestone Step 4.
 *
 * Pure-helper coverage for `selectStatuslineKnobs`. node-env vitest;
 * no DOM, no Solid imports — same precedent as
 * `askuser-card-helpers.test.ts`, `phase-card-helpers.test.ts`.
 *
 * Cases:
 *   - full valid config → all five keys populated
 *   - partial config → only present keys populated
 *   - missing config (null / undefined / non-object) → all null
 *   - non-string values → null
 *   - empty-string value → null
 *   - drift guard: out-of-vocab value → null (defends against config.json
 *     typos surfacing as mystery values in the statusline)
 */

import { describe, expect, it } from 'vitest';

import {
  STATUSLINE_KNOB_KEYS,
  selectStatuslineKnobs,
} from '../src/client/components/statusline-helpers.js';

describe('STATUSLINE_KNOB_KEYS', () => {
  it('lists the five statusline knobs in display order', () => {
    expect([...STATUSLINE_KNOB_KEYS]).toEqual([
      'backend',
      'effort',
      'autonomy',
      'model_profile',
      'verification_tier',
    ]);
  });
});

describe('selectStatuslineKnobs', () => {
  it('returns all-null for null / undefined / non-object configs', () => {
    expect(selectStatuslineKnobs(null)).toEqual({
      backend: null,
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
    expect(selectStatuslineKnobs(undefined)).toEqual({
      backend: null,
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
    expect(selectStatuslineKnobs('not-an-object')).toEqual({
      backend: null,
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
    expect(selectStatuslineKnobs(42)).toEqual({
      backend: null,
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
  });

  it('returns all five values when the config is fully populated', () => {
    expect(
      selectStatuslineKnobs({
        backend: 'codex',
        effort: 'thorough',
        autonomy: 'standard',
        model_profile: 'quality',
        verification_tier: 'deep',
        // Extra keys are ignored.
        unrelated: 'ignore-me',
      }),
    ).toEqual({
      backend: 'codex',
      effort: 'thorough',
      autonomy: 'standard',
      model_profile: 'quality',
      verification_tier: 'deep',
    });
  });

  it('returns partial values when only some keys are present', () => {
    expect(
      selectStatuslineKnobs({
        effort: 'fast',
        verification_tier: 'quick',
      }),
    ).toEqual({
      backend: null,
      effort: 'fast',
      autonomy: null,
      model_profile: null,
      verification_tier: 'quick',
    });
  });

  it('returns null for non-string values', () => {
    expect(
      selectStatuslineKnobs({
        backend: 42,
        effort: null,
        autonomy: undefined,
        model_profile: { nested: 'obj' },
        verification_tier: true,
      }),
    ).toEqual({
      backend: null,
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
  });

  it('returns null for empty-string values', () => {
    expect(
      selectStatuslineKnobs({
        backend: '',
        effort: 'balanced',
      }),
    ).toEqual({
      backend: null,
      effort: 'balanced',
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
  });

  it('rejects out-of-vocab values (drift guard)', () => {
    // `'super-quality'` is not in CONFIG_ENUM_OPTIONS.model_profile; the
    // helper drops it to null so the statusline shows `—` instead of a
    // mystery string an operator typed into config.json.
    expect(
      selectStatuslineKnobs({
        backend: 'claude-code',
        effort: 'balanced',
        autonomy: 'cautious',
        model_profile: 'super-quality',
        verification_tier: 'standard',
      }),
    ).toEqual({
      backend: 'claude-code',
      effort: 'balanced',
      autonomy: 'cautious',
      model_profile: null,
      verification_tier: 'standard',
    });
  });

  it('accepts every value listed in CONFIG_ENUM_OPTIONS for each knob', () => {
    // The five real enums per `config-enum-vocab.ts`.
    const cases: Array<[string, ReadonlyArray<string>]> = [
      ['backend', ['codex', 'claude-code', 'ollama']],
      ['effort', ['thorough', 'balanced', 'fast', 'turbo']],
      ['autonomy', ['cautious', 'standard', 'confident', 'pure-vibe']],
      ['model_profile', ['quality', 'balanced', 'cost']],
      ['verification_tier', ['quick', 'standard', 'deep']],
    ];
    for (const [key, vocab] of cases) {
      for (const v of vocab) {
        const out = selectStatuslineKnobs({ [key]: v });
        expect(out[key as keyof typeof out]).toBe(v);
      }
    }
  });
});
