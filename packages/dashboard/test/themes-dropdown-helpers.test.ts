/**
 * Pure-helper coverage for `lib/themes-dropdown-helpers.ts`. The component
 * itself ships a smoke-test in `themes-dropdown.test.ts` — load-bearing
 * logic (option order + theme guard + DOM mutator) lives here.
 *
 * The dashboard's vitest config runs `environment: 'node'` with no Solid
 * testing-library; we stub `document` via `vi.stubGlobal` to exercise
 * the `applyTheme` helper's DOM-mutation path.
 */

import { THEMES } from '@swt-labs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_THEMES,
  THEME_OPTIONS,
  applyTheme,
  isTheme,
  type ThemeOption,
} from '../src/client/lib/themes-dropdown-helpers.js';

describe('LOCAL_THEMES — parity with @swt-labs/core THEMES', () => {
  it('mirrors the canonical THEMES constant in core (count + order)', () => {
    // The helper module defines LOCAL_THEMES as a browser-bundling
    // workaround (see the module-level comment). This test locks the two
    // lists in lockstep — if core's THEMES gains, drops, or reorders an
    // entry, the dashboard's LOCAL_THEMES must follow.
    expect(LOCAL_THEMES).toEqual([...THEMES]);
  });
});

describe('THEME_OPTIONS', () => {
  it('exposes exactly 8 entries', () => {
    expect(THEME_OPTIONS.length).toBe(8);
  });

  it('leads with default (the SWT canon)', () => {
    expect(THEME_OPTIONS[0]?.id).toBe('default');
  });

  it('places dark + light immediately after default (the most-expected toggles)', () => {
    expect(THEME_OPTIONS[1]?.id).toBe('dark');
    expect(THEME_OPTIONS[2]?.id).toBe('light');
  });

  it('alphabetises the five named developer themes after dark/light', () => {
    const namedDev = THEME_OPTIONS.slice(3).map((o) => o.id);
    expect(namedDev).toEqual(['dracula', 'gruvbox', 'monokai', 'nord', 'solarized']);
  });

  it('every option has a non-empty label and description', () => {
    for (const opt of THEME_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.description.length).toBeGreaterThan(0);
    }
  });

  it('every option id is unique', () => {
    const ids = THEME_OPTIONS.map((o) => o.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('ThemeOption type is structurally correct', () => {
    // Compile-time guard: a mis-typed entry would fail to compile.
    const sanity: readonly ThemeOption[] = THEME_OPTIONS;
    expect(sanity.length).toBe(THEME_OPTIONS.length);
  });
});

describe('isTheme', () => {
  it('returns true for each of the 8 known theme ids', () => {
    expect(isTheme('default')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('solarized')).toBe(true);
    expect(isTheme('dracula')).toBe(true);
    expect(isTheme('nord')).toBe(true);
    expect(isTheme('monokai')).toBe(true);
    expect(isTheme('gruvbox')).toBe(true);
  });

  it('returns false for unknown strings', () => {
    expect(isTheme('midnight')).toBe(false);
    expect(isTheme('DEFAULT')).toBe(false); // case-sensitive
    expect(isTheme('')).toBe(false);
    expect(isTheme('default ')).toBe(false); // whitespace
  });

  it('returns false for non-string values', () => {
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(0)).toBe(false);
    expect(isTheme({})).toBe(false);
    expect(isTheme([])).toBe(false);
    expect(isTheme(false)).toBe(false);
  });
});

describe('applyTheme', () => {
  let setAttribute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAttribute = vi.fn();
    vi.stubGlobal('document', {
      documentElement: { setAttribute },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets data-theme on <html> for each known theme', () => {
    applyTheme('dracula');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'dracula');

    applyTheme('default');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'default');

    applyTheme('light');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('intentionally sets data-theme="default" rather than removing the attribute', () => {
    // Symmetric with the named themes; makes assertions crisp and matches
    // the styles.css fallback behaviour (`:root[data-theme="default"]` is
    // intentionally undefined and inherits the bare `:root` block).
    applyTheme('default');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'default');
    expect(setAttribute).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when document is undefined (node-env safety)', () => {
    vi.stubGlobal('document', undefined);
    expect(() => applyTheme('dracula')).not.toThrow();
  });
});
