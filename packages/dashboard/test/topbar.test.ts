/**
 * TopBar verb-dropdown coverage — the pure compose/route helpers.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see `options-menu.test.ts`
 * / `settings-section.test.ts` for the same constraint). The TopBar verb
 * dropdown's load-bearing logic is therefore factored into PURE exported
 * helpers — `composeCommand` and `canSubmit` — unit-tested directly here,
 * plus a smoke test that `TopBar` is a callable Solid component and
 * `ACTION_VERBS` leads with `cook`.
 *
 * This replaces the (removed) `classifyInput` heuristic verb-guessing: the
 * dropdown makes the verb explicit, so routing is now a pure function of
 * (selected verb, typed input) rather than a guess off the typed text.
 */

import { describe, expect, it } from 'vitest';

import {
  ACTION_VERBS,
  TopBar,
  canSubmit,
  composeCommand,
} from '../src/client/components/TopBar.jsx';

describe('composeCommand', () => {
  it('routes cook through vibe with the bare trimmed text (no "cook " prefix)', () => {
    expect(composeCommand('cook', 'build me a snake game')).toEqual({
      route: 'vibe',
      value: 'build me a snake game',
    });
  });

  it('trims the cook prompt', () => {
    expect(composeCommand('cook', '  ship the dashboard  ')).toEqual({
      route: 'vibe',
      value: 'ship the dashboard',
    });
  });

  it('routes cook through vibe with an empty value when input is blank', () => {
    expect(composeCommand('cook', '   ')).toEqual({ route: 'vibe', value: '' });
  });

  it('composes research as a command-route `research <text>`', () => {
    expect(composeCommand('research', 'solid signals')).toEqual({
      route: 'command',
      value: 'research solid signals',
    });
  });

  it('composes qa with input as a command-route `qa <text>`', () => {
    expect(composeCommand('qa', '03')).toEqual({ route: 'command', value: 'qa 03' });
  });

  it('composes verify with input as a command-route `verify <text>`', () => {
    expect(composeCommand('verify', '04')).toEqual({ route: 'command', value: 'verify 04' });
  });

  it('composes map with input as a command-route `map <text>`', () => {
    expect(composeCommand('map', 'packages/core')).toEqual({
      route: 'command',
      value: 'map packages/core',
    });
  });

  it('collapses an empty-input non-cook verb to just the bare verb', () => {
    expect(composeCommand('qa', '')).toEqual({ route: 'command', value: 'qa' });
    expect(composeCommand('verify', '   ')).toEqual({ route: 'command', value: 'verify' });
    expect(composeCommand('map', '')).toEqual({ route: 'command', value: 'map' });
  });

  it('trims the typed text for non-cook verbs', () => {
    expect(composeCommand('research', '  graph theory  ')).toEqual({
      route: 'command',
      value: 'research graph theory',
    });
  });
});

describe('canSubmit', () => {
  it('blocks cook when the input is empty', () => {
    expect(canSubmit('cook', '')).toBe(false);
    expect(canSubmit('cook', '   ')).toBe(false);
  });

  it('allows cook when the input is non-empty', () => {
    expect(canSubmit('cook', 'do the thing')).toBe(true);
  });

  it('blocks research when the input is empty', () => {
    expect(canSubmit('research', '')).toBe(false);
  });

  it('allows research when the input is non-empty', () => {
    expect(canSubmit('research', 'a topic')).toBe(true);
  });

  it('always allows qa / verify / map regardless of input', () => {
    expect(canSubmit('qa', '')).toBe(true);
    expect(canSubmit('verify', '')).toBe(true);
    expect(canSubmit('map', '')).toBe(true);
    expect(canSubmit('qa', '03')).toBe(true);
  });
});

describe('ACTION_VERBS', () => {
  it('lists exactly the 5 action verbs', () => {
    expect(ACTION_VERBS.map((v) => v.value)).toEqual([
      'cook',
      'research',
      'qa',
      'verify',
      'map',
    ]);
  });

  it('leads with cook (the default selection)', () => {
    expect(ACTION_VERBS[0]?.value).toBe('cook');
  });

  it('marks cook and research as requiring input; qa/verify/map as not', () => {
    const byValue = new Map(ACTION_VERBS.map((v) => [v.value, v.requiresInput]));
    expect(byValue.get('cook')).toBe(true);
    expect(byValue.get('research')).toBe(true);
    expect(byValue.get('qa')).toBe(false);
    expect(byValue.get('verify')).toBe(false);
    expect(byValue.get('map')).toBe(false);
  });
});

describe('TopBar component', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof TopBar).toBe('function');
  });
});
