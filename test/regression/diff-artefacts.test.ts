/**
 * Unit tests for the `diffArtefacts` allowed-drift comparator per
 * TDD2 §14.6. Synthetic fixtures only — no recordings required.
 *
 * Exercises each artefact category:
 *   - STATE.md: timestamp drift allowed; Levenshtein bounded
 *   - PLAN.md: task-ID prefix drift allowed; content fingerprint enforced
 *   - VERIFICATION.md: timestamps allowed; counts must match
 *   - Semantic fingerprint (scout-briefs/, debug-reports/): URLs + headings
 *   - Default byte-exact: any other .md file
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classify,
  compareFile,
  diffArtefacts,
  levenshtein,
  type DiffViolation,
} from '../../packages/test-utils/src/diff-artefacts.js';

function mkFixture(): { actual: string; expected: string } {
  const root = mkdtempSync(join(tmpdir(), 'swt-diff-art-'));
  return { actual: join(root, 'actual'), expected: join(root, 'expected') };
}

function write(root: string, rel: string, body: string): void {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, body);
}

describe('classify', () => {
  it.each<[string, ReturnType<typeof classify>]>([
    ['STATE.md', 'state-md'],
    ['phases/01-foo/01-01-PLAN.md', 'plan-md'],
    ['phases/02-bar/02-VERIFICATION.md', 'verification-counts'],
    ['phases/02-bar/02-QA.md', 'verification-counts'],
    ['scout-briefs/brief-01.md', 'semantic-fingerprint'],
    ['debug-reports/2026-05-12.md', 'semantic-fingerprint'],
    ['README.md', 'byte-exact'],
    ['phases/01-foo/SOMETHING.md', 'byte-exact'],
  ])('classifies %s as %s', (path, expected) => {
    expect(classify(path)).toBe(expected);
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello world', 'hello world')).toBe(0);
  });

  it('returns the length for an empty other side', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('counts single-char substitutions', () => {
    expect(levenshtein('kitten', 'sitten')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('compareFile — state-md', () => {
  it('returns undefined when only activity-log timestamps differ', () => {
    const expected = [
      '## Current Phase',
      'Phase: 2 of 6',
      '## Activity Log',
      '- 2026-05-01: did a thing',
    ].join('\n');
    const actual = [
      '## Current Phase',
      'Phase: 2 of 6',
      '## Activity Log',
      '- 2026-05-12: did a thing',
    ].join('\n');
    expect(compareFile(actual, expected, 'state-md')).toBeUndefined();
  });

  it('flags phase-summary drift exceeding the Levenshtein ceiling', () => {
    const expected = '## Current Phase\nPhase: 2 of 6\nStatus: active\n';
    const actual =
      '## Current Phase\n' +
      'Phase: 99 of 999\n' +
      'Status: brand new completely rewritten phase block that should not match\n';
    const detail = compareFile(actual, expected, 'state-md', { stateMdLevenshteinMax: 5 });
    expect(detail).toMatch(/Levenshtein distance \d+ > 5/);
  });

  it('strips ISO timestamps anywhere in the body before comparing', () => {
    const expected = '## Current Phase\nLast updated 2026-05-01T10:00:00Z\n';
    const actual = '## Current Phase\nLast updated 2026-05-12T15:30:42.123Z\n';
    expect(compareFile(actual, expected, 'state-md')).toBeUndefined();
  });
});

describe('compareFile — plan-md', () => {
  it('returns undefined when only task-ID prefixes differ', () => {
    const expected = 'Task PR-12: do the thing\nTask PR-13: also do thing\n';
    const actual = 'Task PR-99: do the thing\nTask PR-77: also do thing\n';
    expect(compareFile(actual, expected, 'plan-md')).toBeUndefined();
  });

  it('flags genuine content drift', () => {
    const expected = 'Task PR-12: write a regression test\n';
    const actual = 'Task PR-12: delete all files and run\n';
    const detail = compareFile(actual, expected, 'plan-md');
    expect(detail).toMatch(/task content fingerprint mismatch/);
  });
});

describe('compareFile — verification-counts', () => {
  it('returns undefined when counts match exactly (timestamps differ)', () => {
    const expected = 'passed: 18\nfailed: 0\ntotal: 18\ndate: 2026-05-01\n';
    const actual = 'passed: 18\nfailed: 0\ntotal: 18\ndate: 2026-05-12\n';
    expect(compareFile(actual, expected, 'verification-counts')).toBeUndefined();
  });

  it('flags any count mismatch', () => {
    const expected = 'passed: 18\nfailed: 0\ntotal: 18\n';
    const actual = 'passed: 17\nfailed: 1\ntotal: 18\n';
    const detail = compareFile(actual, expected, 'verification-counts');
    expect(detail).toMatch(/count mismatch on passed: actual=17, expected=18/);
  });
});

describe('compareFile — semantic-fingerprint', () => {
  it('returns undefined when headings + URLs match (body text differs)', () => {
    const expected = [
      '# Scout brief',
      'A long verbose paragraph about the codebase.',
      'See https://example.com/foo for context.',
    ].join('\n');
    const actual = [
      '# Scout brief',
      'A different verbose paragraph saying the same thing.',
      'See https://example.com/foo for context.',
    ].join('\n');
    expect(compareFile(actual, expected, 'semantic-fingerprint')).toBeUndefined();
  });

  it('flags when a URL is dropped', () => {
    const expected = '# Brief\nSee https://example.com/foo\n';
    const actual = '# Brief\nNo URL here\n';
    expect(compareFile(actual, expected, 'semantic-fingerprint')).toMatch(
      /semantic fingerprint mismatch/,
    );
  });
});

describe('compareFile — byte-exact', () => {
  it('returns undefined on identical input', () => {
    expect(compareFile('hello', 'hello', 'byte-exact')).toBeUndefined();
  });

  it('flags any difference', () => {
    expect(compareFile('hello', 'hello!', 'byte-exact')).toMatch(/byte-exact mismatch/);
  });
});

describe('diffArtefacts — full-tree walk', () => {
  it('returns no violations for a clean run (timestamp + task-ID drift only)', () => {
    const { actual, expected } = mkFixture();
    write(
      expected,
      'STATE.md',
      '## Current Phase\nPhase: 2 of 6\n## Activity Log\n- 2026-05-01: a\n',
    );
    write(
      actual,
      'STATE.md',
      '## Current Phase\nPhase: 2 of 6\n## Activity Log\n- 2026-05-12: a\n',
    );
    write(expected, 'phases/01-foo/01-01-PLAN.md', 'Task PR-12: do work\n');
    write(actual, 'phases/01-foo/01-01-PLAN.md', 'Task PR-99: do work\n');
    write(
      expected,
      'phases/01-foo/01-VERIFICATION.md',
      'passed: 5\nfailed: 0\ntotal: 5\ndate: 2026-05-01\n',
    );
    write(
      actual,
      'phases/01-foo/01-VERIFICATION.md',
      'passed: 5\nfailed: 0\ntotal: 5\ndate: 2026-05-12\n',
    );

    const result = diffArtefacts(actual, expected);
    expect(result.violations).toEqual([]);
  });

  it('reports a violation when an expected file is missing in actual', () => {
    const { actual, expected } = mkFixture();
    write(expected, 'STATE.md', '## Current Phase\nx\n');
    write(expected, 'phases/01-foo/01-VERIFICATION.md', 'passed: 1\nfailed: 0\ntotal: 1\n');
    // actual is missing the VERIFICATION file
    write(actual, 'STATE.md', '## Current Phase\nx\n');

    const result = diffArtefacts(actual, expected);
    expect(result.violations).toHaveLength(1);
    const v = result.violations[0] as DiffViolation;
    expect(v.path).toBe('phases/01-foo/01-VERIFICATION.md');
    expect(v.category).toBe('missing');
  });

  it('reports drift across multiple files', () => {
    const { actual, expected } = mkFixture();
    write(expected, 'STATE.md', '## Current Phase\nA tiny block\n');
    write(
      actual,
      'STATE.md',
      '## Current Phase\nA dramatically different block of text that is way over the bound and should certainly trip the Levenshtein gate; this is a paragraph long enough to exceed any reasonable threshold and demonstrate the drift detector in action.\n',
    );
    write(expected, 'phases/01-foo/01-VERIFICATION.md', 'passed: 10\nfailed: 0\ntotal: 10\n');
    write(actual, 'phases/01-foo/01-VERIFICATION.md', 'passed: 8\nfailed: 2\ntotal: 10\n');

    const result = diffArtefacts(actual, expected, { stateMdLevenshteinMax: 50 });
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    const categories = result.violations.map((v) => v.category);
    expect(categories).toContain('state-md');
    expect(categories).toContain('verification-counts');
  });
});
