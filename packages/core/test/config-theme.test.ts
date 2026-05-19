/**
 * Theme field — schema validation coverage for the milestone that added
 * the `theme` enum + THEMES constant to `SwtConfig`. The bare 8-value enum
 * lives in `core/src/config/Config.ts` so it can be referenced from any
 * package (CLI, dashboard, TUI); this test locks the contract.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, THEMES, parseConfig, type Theme } from '../src/config/Config.js';
import { ConfigError } from '../src/errors/SwtError.js';

describe('SwtConfig — theme field', () => {
  it('exposes exactly 8 named theme ids in the canonical order', () => {
    expect(THEMES).toEqual([
      'default',
      'dark',
      'light',
      'solarized',
      'dracula',
      'nord',
      'monokai',
      'gruvbox',
    ]);
  });

  it("defaults to 'default' when theme is omitted", () => {
    expect(DEFAULT_CONFIG.theme).toBe('default');
  });

  it('accepts each of the 8 named themes', () => {
    for (const theme of THEMES) {
      const cfg = parseConfig({ theme });
      expect(cfg.theme).toBe(theme);
    }
  });

  it('rejects an unknown theme id', () => {
    expect(() => parseConfig({ theme: 'midnight' })).toThrow(ConfigError);
    expect(() => parseConfig({ theme: 'DEFAULT' })).toThrow(ConfigError); // case-sensitive
    expect(() => parseConfig({ theme: '' })).toThrow(ConfigError);
    expect(() => parseConfig({ theme: null })).toThrow(ConfigError);
    expect(() => parseConfig({ theme: 42 })).toThrow(ConfigError);
  });

  it('preserves the theme through a round-trip parse', () => {
    const original = parseConfig({ theme: 'dracula' });
    const round = parseConfig(original);
    expect(round.theme).toBe('dracula');
  });

  it('preserves backwards-compat with configs that predate the theme field', () => {
    // A config.json written before this milestone wouldn't have a theme
    // field; parseConfig must inject 'default' rather than reject.
    const legacy = parseConfig({ effort: 'thorough', auto_commit: true });
    expect(legacy.theme).toBe('default');
  });

  it('Theme type is the union of THEMES', () => {
    // Compile-time guard — if THEMES drops an entry, this fails to compile.
    const sanity: readonly Theme[] = [
      'default',
      'dark',
      'light',
      'solarized',
      'dracula',
      'nord',
      'monokai',
      'gruvbox',
    ];
    expect(sanity.length).toBe(THEMES.length);
  });
});
