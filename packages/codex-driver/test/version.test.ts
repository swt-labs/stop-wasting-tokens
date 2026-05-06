import { describe, expect, it } from 'vitest';

import { meetsMinimumVersion, parseCodexVersion } from '../src/version.js';

describe('Codex version detection', () => {
  it('parses a vanilla --version line', () => {
    expect(parseCodexVersion('codex 0.124.0\n')).toEqual({
      version: '0.124.0',
      major: 0,
      minor: 124,
      patch: 0,
    });
  });

  it('parses a version embedded in a longer banner', () => {
    expect(parseCodexVersion('Codex CLI build 1.2.3 (commit abcdef)')).toMatchObject({
      version: '1.2.3',
    });
  });

  it('returns undefined when no version can be found', () => {
    expect(parseCodexVersion('hello there')).toBeUndefined();
  });

  it('compares versions correctly', () => {
    const detected = parseCodexVersion('0.124.0');
    expect(meetsMinimumVersion(detected, { major: 0, minor: 124 })).toBe(true);
    expect(meetsMinimumVersion(detected, { major: 0, minor: 125 })).toBe(false);
    expect(meetsMinimumVersion(detected, { major: 0, minor: 124, patch: 1 })).toBe(false);
    expect(meetsMinimumVersion(detected, { major: 1, minor: 0 })).toBe(false);
    expect(meetsMinimumVersion(undefined, { major: 0, minor: 1 })).toBe(false);
  });
});
