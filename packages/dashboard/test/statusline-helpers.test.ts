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
  STATUSLINE_CELL_IDS,
  STATUSLINE_KNOB_KEYS,
  computeIsGroupStart,
  selectStatuslineKnobs,
  statuslineCellSection,
} from '../src/client/components/statusline-helpers.js';

describe('STATUSLINE_KNOB_KEYS', () => {
  it('lists the four statusline knobs in display order (v2 Wave 3: backend dropped)', () => {
    expect([...STATUSLINE_KNOB_KEYS]).toEqual([
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
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
    expect(selectStatuslineKnobs(undefined)).toEqual({
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
    expect(selectStatuslineKnobs('not-an-object')).toEqual({
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
    expect(selectStatuslineKnobs(42)).toEqual({
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
  });

  it('returns all four values when the config is fully populated', () => {
    expect(
      selectStatuslineKnobs({
        effort: 'thorough',
        autonomy: 'standard',
        model_profile: 'quality',
        verification_tier: 'deep',
        // Extra keys are ignored (including the dropped `backend` —
        // v2 Wave 3 strips the cell; presence in config.json is no
        // longer a concern of the statusline).
        backend: 'codex',
        unrelated: 'ignore-me',
      }),
    ).toEqual({
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
      effort: 'fast',
      autonomy: null,
      model_profile: null,
      verification_tier: 'quick',
    });
  });

  it('returns null for non-string values', () => {
    expect(
      selectStatuslineKnobs({
        effort: null,
        autonomy: undefined,
        model_profile: { nested: 'obj' },
        verification_tier: true,
      }),
    ).toEqual({
      effort: null,
      autonomy: null,
      model_profile: null,
      verification_tier: null,
    });
  });

  it('returns null for empty-string values', () => {
    expect(
      selectStatuslineKnobs({
        effort: 'balanced',
        autonomy: '',
      }),
    ).toEqual({
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
        effort: 'balanced',
        autonomy: 'cautious',
        model_profile: 'super-quality',
        verification_tier: 'standard',
      }),
    ).toEqual({
      effort: 'balanced',
      autonomy: 'cautious',
      model_profile: null,
      verification_tier: 'standard',
    });
  });

  it('accepts every value listed in CONFIG_ENUM_OPTIONS for each knob', () => {
    // The four real enums per `config-enum-vocab.ts` (backend dropped).
    const cases: Array<[string, ReadonlyArray<string>]> = [
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

// v2 Wave 6 commit 16 — canonical cell-id vocabulary + section helpers
// that the upcoming render-by-order refactor will iterate. Pure
// helpers; tested directly.
describe('STATUSLINE_CELL_IDS', () => {
  it('lists every default cell in canonical left-to-right order', () => {
    expect([...STATUSLINE_CELL_IDS]).toEqual([
      'repo',
      'branch',
      'provider',
      'dot',
      'effort',
      'autonomy',
      'model',
      'verify',
      'cook',
      'orchestrator',
      'agents',
      'ctx',
      'rate',
      'session-cost',
      'tokens',
      'rollup-7d',
      'rollup-30d',
    ]);
  });
});

describe('statuslineCellSection', () => {
  it('assigns each cell to its section', () => {
    expect(statuslineCellSection('repo')).toBe('project');
    expect(statuslineCellSection('branch')).toBe('project');
    expect(statuslineCellSection('provider')).toBe('identity');
    expect(statuslineCellSection('dot')).toBe('identity');
    expect(statuslineCellSection('effort')).toBe('config');
    expect(statuslineCellSection('verify')).toBe('config');
    expect(statuslineCellSection('cook')).toBe('runtime');
    expect(statuslineCellSection('ctx')).toBe('runtime');
    expect(statuslineCellSection('rate')).toBe('money');
    expect(statuslineCellSection('rollup-30d')).toBe('money');
  });
});

describe('computeIsGroupStart', () => {
  it('first cell is never a group start (handled by :first-of-type CSS)', () => {
    expect(computeIsGroupStart([...STATUSLINE_CELL_IDS], 0)).toBe(false);
  });

  it('flags the first cell of each new section when the previous cell was in a different section', () => {
    const order = [...STATUSLINE_CELL_IDS];
    // 'provider' follows 'branch' — project → identity transition.
    const providerIdx = order.indexOf('provider');
    expect(computeIsGroupStart(order, providerIdx)).toBe(true);
    // 'effort' follows 'dot' — identity → config transition.
    const effortIdx = order.indexOf('effort');
    expect(computeIsGroupStart(order, effortIdx)).toBe(true);
    // 'cook' follows 'verify' — config → runtime transition.
    const cookIdx = order.indexOf('cook');
    expect(computeIsGroupStart(order, cookIdx)).toBe(true);
    // 'rate' follows 'ctx' — runtime → money transition.
    const rateIdx = order.indexOf('rate');
    expect(computeIsGroupStart(order, rateIdx)).toBe(true);
  });

  it('does NOT flag cells whose section matches the previous cell', () => {
    const order = [...STATUSLINE_CELL_IDS];
    // 'branch' follows 'repo' — both 'project'.
    expect(computeIsGroupStart(order, order.indexOf('branch'))).toBe(false);
    // 'autonomy' follows 'effort' — both 'config'.
    expect(computeIsGroupStart(order, order.indexOf('autonomy'))).toBe(false);
    // 'tokens' follows 'session-cost' — both 'money'.
    expect(computeIsGroupStart(order, order.indexOf('tokens'))).toBe(false);
  });

  it('handles reordered arrays correctly (custom user order)', () => {
    // User puts money cells first, then identity.
    const order = ['rate', 'session-cost', 'provider', 'dot'] as const;
    expect(computeIsGroupStart(order, 0)).toBe(false);
    // 'session-cost' follows 'rate' — both money → no separator.
    expect(computeIsGroupStart(order, 1)).toBe(false);
    // 'provider' follows 'session-cost' — money → identity transition.
    expect(computeIsGroupStart(order, 2)).toBe(true);
    // 'dot' follows 'provider' — both identity → no separator.
    expect(computeIsGroupStart(order, 3)).toBe(false);
  });

  it('returns false for out-of-bounds indices (defensive)', () => {
    const order = [...STATUSLINE_CELL_IDS];
    expect(computeIsGroupStart(order, -1)).toBe(false);
    expect(computeIsGroupStart(order, order.length)).toBe(false);
    expect(computeIsGroupStart(order, order.length + 5)).toBe(false);
  });
});
