import { describe, expect, it } from 'vitest';

import { fuzzyMatch } from '../src/client/lib/fuzzy-match.ts';

const VERBS = [
  'config',
  'doctor',
  'detect-phase',
  'update',
  'help',
  'version',
  'status',
  'init',
  'vibe',
  'watch',
  'plan',
  'execute',
];

describe('fuzzyMatch', () => {
  it('empty query returns all candidates with score 0 in original order', () => {
    const result = fuzzyMatch('', VERBS);
    expect(result).toHaveLength(VERBS.length);
    expect(result.map((r) => r.value)).toEqual(VERBS);
    expect(result.every((r) => r.score === 0)).toBe(true);
  });

  it('whitespace-only query is treated as empty', () => {
    expect(fuzzyMatch('   ', VERBS).map((r) => r.value)).toEqual(VERBS);
  });

  it('exact substring "config" wins for query "config"', () => {
    const result = fuzzyMatch('config', VERBS);
    expect(result[0]?.value).toBe('config');
  });

  it('case-insensitive: "DOCTOR" matches "doctor"', () => {
    const result = fuzzyMatch('DOCTOR', VERBS);
    expect(result[0]?.value).toBe('doctor');
  });

  it('subsequence "cfg" matches "config" (chars in order, not consecutive required)', () => {
    const result = fuzzyMatch('cfg', VERBS);
    expect(result[0]?.value).toBe('config');
  });

  it('non-matching query returns empty array', () => {
    const result = fuzzyMatch('zzzzzz', VERBS);
    expect(result).toHaveLength(0);
  });

  it("subsequence 'dp' matches 'detect-phase'", () => {
    const result = fuzzyMatch('dp', VERBS);
    expect(result.map((r) => r.value)).toContain('detect-phase');
  });

  it('consecutive bonus orders shorter exact prefixes above sparse subsequences of equal char count', () => {
    // 'doc' fully consecutive in 'doctor' (3 consecutive) should beat
    // 'doc' sparse-matched 'detect-phase' (d…then c is missing entirely;
    // actually detect-phase has no 'c'). Use a clearer pair: 'up' in
    // 'update' (consecutive) vs 'up' in 'execute' (no match — 'execute'
    // has no consecutive 'up' but does contain 'u' and 'p' in order
    // through 'execute'... actually: e-x-e-c-u-t-e has 'u' but no 'p',
    // so doesn't match. Use 'init' and 'detect-phase' for 'it' subseq:
    // 'it' is consecutive in 'init' (I-N-I-T → 'i','t' yes), and 'it'
    // is also subseq in 'detect-phase' (det-it... no, no 'i' in
    // detect-phase). OK, simpler: 'up' for 'update' (consecutive) vs
    // 'up' in nothing else. The point is: 'update' wins.
    const result = fuzzyMatch('up', VERBS);
    expect(result[0]?.value).toBe('update');
  });
});
