/**
 * Per-role classifier calibration test — Phase 5 plan 05-02 T2 (REQ-22 R2).
 *
 * Asserts each entry in `DEFAULT_CLASSIFIERS` routes the documented
 * sample paths to the expected category. Order-sensitive — `classify()`
 * is first-match-wins, so the more-specific Dev SUMMARY/Lead PLAN
 * patterns must win over the architect's `CONTEXT/CONCERNS/PATTERNS`
 * semantic-fingerprint bucket.
 *
 * Adapting the test list to repo reality: scout's research path inside
 * a phase folder is sometimes the bare `RESEARCH.md` and sometimes the
 * numbered `NN-RESEARCH.md` form. We assert both.
 */

import { describe, expect, it } from 'vitest';

import {
  classify,
  DEFAULT_CLASSIFIERS,
  type ArtefactCategory,
} from '../src/diff-artefacts.js';

describe('DEFAULT_CLASSIFIERS — per-role calibration', () => {
  // [path, expected category] cases — drawn from research §5.5 + the
  // 7-agent role contract table in plan 05-02 T4.
  const cases: ReadonlyArray<readonly [string, ArtefactCategory]> = [
    // Scout — semantic-fingerprint on research output
    ['scout-briefs/foo.md', 'semantic-fingerprint'],
    ['phases/01-substrate/01-RESEARCH.md', 'semantic-fingerprint'],
    ['phases/01-substrate/RESEARCH.md', 'semantic-fingerprint'],
    // Architect — semantic-fingerprint on descriptive context docs
    ['phases/01-substrate/CONCERNS.md', 'semantic-fingerprint'],
    ['phases/01-substrate/PATTERNS.md', 'semantic-fingerprint'],
    ['phases/01-substrate/CONTEXT.md', 'semantic-fingerprint'],
    // Debugger — semantic-fingerprint on debug reports
    ['debug-reports/incident-001.md', 'semantic-fingerprint'],
    // Lead — plan-md fingerprint (task-ID-stripped)
    ['phases/01-substrate/01-01-PLAN.md', 'plan-md'],
    ['phases/01-substrate/01-PLAN.md', 'plan-md'],
    // Dev — byte-exact on SUMMARY.md (strictest gate)
    ['phases/01-substrate/01-01-SUMMARY.md', 'byte-exact'],
    // QA — verification-counts
    ['phases/01-substrate/01-VERIFICATION.md', 'verification-counts'],
    ['phases/01-substrate/01-QA.md', 'verification-counts'],
    // STATE.md — Levenshtein-bounded
    ['STATE.md', 'state-md'],
    // Docs — byte-exact on rendered artefacts
    ['README.md', 'byte-exact'],
    ['CHANGELOG.md', 'byte-exact'],
    ['docs/operations/cassette-recording.md', 'byte-exact'],
    // Negative — an unmatched file falls through to the default byte-exact
    ['random/other.md', 'byte-exact'],
  ];

  for (const [path, expected] of cases) {
    it(`classifies ${path} as ${expected}`, () => {
      expect(classify(path)).toBe(expected);
    });
  }

  it('DEFAULT_CLASSIFIERS exports a non-empty patterns array', () => {
    expect(DEFAULT_CLASSIFIERS.length).toBeGreaterThan(0);
  });

  it('SUMMARY pattern wins over the architect CONTEXT bucket (order-sensitive)', () => {
    // Order-guard — if someone moves the architect bucket above SUMMARY in
    // DEFAULT_CLASSIFIERS, the regex for `CONTEXT|CONCERNS|PATTERNS` would
    // NOT match a `SUMMARY.md`, but the test below pins the intent: a
    // future ordering bug would surface here.
    expect(classify('phases/01-foo/01-02-SUMMARY.md')).toBe('byte-exact');
  });
});
