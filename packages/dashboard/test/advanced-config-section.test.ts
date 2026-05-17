/**
 * Plan 01-03 T3c — `<AdvancedConfigSection>` controlled-editor coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `provider-auth-panel.test.ts` / `options-menu.test.ts` /
 * `settings-section.test.ts` for the same constraint). To keep this plan's
 * test deliverable shippable without a workspace dep bump, the section's
 * load-bearing behaviour is factored into PURE exported helpers —
 * `getAtPath`, `isPathStaged` — which are unit-tested directly here, plus
 * structural source-text assertions on the rendered tree (depth-1 entries
 * render FLAT — no top-level `<details>` — while depth ≥ 2 may keep
 * `<details>` as a layout aid), and the staging contract that the
 * controlled `onChange(path, value)` callback drives.
 *
 * The "controlled editor" contract this file proves:
 *
 *   1. Per-leaf staging via `onChange([key], value)` — staged values resolve
 *      ahead of the snapshot in the display path (verified via getAtPath +
 *      isPathStaged precedence).
 *   2. Nested staging via `onChange([key1, key2, ...], value)` builds the
 *      nested structure under the path's first segment (verified by the
 *      `stagePathEdit` helper in OptionsMenu — re-exercised here for an
 *      end-to-end "the Advanced surface STAGES correctly via path" claim).
 *   3. Depth-1 entries render flat (no top-level <details>); depth ≥ 2
 *      uses <details> as a layout aid. Source-text assertion over the
 *      AdvancedConfigSection.tsx file.
 *   4. The component is fully controlled: no internal pendingEdits signal,
 *      no Edit/Cancel/Save buttons. The prop contract is the assertion.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AdvancedConfigSection,
  getAtPath,
  isPathStaged,
  type AdvancedConfigSectionProps,
} from '../src/client/components/AdvancedConfigSection.jsx';
import { stagePathEdit } from '../src/client/components/OptionsMenu.jsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  join(__dirname, '../src/client/components/AdvancedConfigSection.tsx'),
  'utf8',
);

/* ── getAtPath — pure tree-walk helper (the staged-display lookup) ── */
describe('getAtPath', () => {
  it('walks the empty path to the root object', () => {
    const root = { a: 1 };
    expect(getAtPath(root, [])).toBe(root);
  });

  it('reads a depth-1 string', () => {
    expect(getAtPath({ effort: 'fast' }, ['effort'])).toBe('fast');
  });

  it('reads a depth-2 nested value', () => {
    expect(getAtPath({ a: { b: 'deep' } }, ['a', 'b'])).toBe('deep');
  });

  it('reads a depth-3 nested value', () => {
    expect(getAtPath({ a: { b: { c: 42 } } }, ['a', 'b', 'c'])).toBe(42);
  });

  it('returns undefined when the path traverses a non-object', () => {
    expect(getAtPath({ a: 'str' }, ['a', 'b'])).toBeUndefined();
  });

  it('returns undefined for a missing top-level key', () => {
    expect(getAtPath({ a: 1 }, ['missing'])).toBeUndefined();
  });

  it('returns undefined when the input is null', () => {
    expect(getAtPath(null, ['anything'])).toBeUndefined();
  });

  it('returns undefined when the input is undefined', () => {
    expect(getAtPath(undefined, ['anything'])).toBeUndefined();
  });

  it('returns undefined for a path through an array (arrays are not objects in the staged-tree semantic)', () => {
    expect(getAtPath({ list: ['a', 'b'] }, ['list', '0'])).toBeUndefined();
  });
});

/* ── isPathStaged — staged-vs-snapshot diff predicate ── */
describe('isPathStaged', () => {
  it('is false when nothing is staged at the path', () => {
    expect(isPathStaged({}, { effort: 'balanced' }, ['effort'])).toBe(false);
  });

  it('is true when the staged value differs from the snapshot', () => {
    expect(isPathStaged({ effort: 'fast' }, { effort: 'balanced' }, ['effort'])).toBe(true);
  });

  it('is false when staged equals snapshot (no visible diff)', () => {
    expect(isPathStaged({ effort: 'balanced' }, { effort: 'balanced' }, ['effort'])).toBe(false);
  });

  it('is false for an explicitly-undefined staged value (treated as "not staged")', () => {
    // The helper guards on `staged === undefined`: an explicit
    // pendingEdits[key] = undefined would otherwise erroneously flip
    // the modified marker on for a field whose snapshot is also
    // undefined. This is the LOCKED defensive choice.
    expect(isPathStaged({ effort: undefined }, { effort: 'balanced' }, ['effort'])).toBe(false);
  });

  it('handles nested-path staging (depth-2)', () => {
    expect(
      isPathStaged({ nested: { inner: 'new' } }, { nested: { inner: 'old' } }, ['nested', 'inner']),
    ).toBe(true);
  });

  it('handles a snapshot whose path traverses a non-object — falls back to undefined snapshot', () => {
    // The staged value differs from undefined (the snapshot can't walk
    // through a primitive), so the diff is true.
    expect(isPathStaged({ a: { b: 'new' } }, { a: 'str' }, ['a', 'b'])).toBe(true);
  });
});

/* ── Controlled-editor staging contract — Advanced onChange drives
 *  pendingEdits via the parent's stagePathEdit. Top-level and nested
 *  paths both round-trip correctly. ── */
describe('controlled-editor staging contract', () => {
  it('top-level enum leaf staged via onChange([key], value)', () => {
    // The parent (OptionsMenu) wires AdvancedConfigSection.onChange to
    // `setPendingEdits((p) => stagePathEdit(p, path, value))`. End-to-end
    // result: a fresh pendingEdits tree with the top-level value set.
    const next = stagePathEdit({}, ['effort'], 'fast');
    expect(next).toEqual({ effort: 'fast' });
    // The snapshot is never mutated by the staging — config is read-only.
    expect(getAtPath(next, ['effort'])).toBe('fast');
  });

  it('top-level boolean leaf staged via onChange', () => {
    const next = stagePathEdit({}, ['auto_uat'], true);
    expect(next).toEqual({ auto_uat: true });
  });

  it('nested path staged via onChange([key1, key2], value) builds nested structure', () => {
    const next = stagePathEdit({}, ['nested_obj', 'inner_key'], 'val');
    expect(next).toEqual({ nested_obj: { inner_key: 'val' } });
  });

  it('repeated staging on the same top-level path overrides the prior value', () => {
    const first = stagePathEdit({}, ['effort'], 'fast');
    const second = stagePathEdit(first, ['effort'], 'turbo');
    expect(second).toEqual({ effort: 'turbo' });
  });

  it('repeated staging on different top-level paths accumulates', () => {
    const first = stagePathEdit({}, ['effort'], 'fast');
    const second = stagePathEdit(first, ['autonomy'], 'cautious');
    expect(second).toEqual({ effort: 'fast', autonomy: 'cautious' });
  });

  it('staging deep does NOT discard sibling staged keys under the same top', () => {
    // Edit-then-re-edit at depth-2 under one top-level key must keep
    // siblings already staged under that same key.
    const first = stagePathEdit({}, ['nested', 'a'], 1);
    const second = stagePathEdit(first, ['nested', 'b'], 2);
    expect(second).toEqual({ nested: { a: 1, b: 2 } });
  });

  it('display-value resolution: staged wins over snapshot at the same path', () => {
    const config = { effort: 'balanced' };
    const pending = stagePathEdit({}, ['effort'], 'fast');
    const staged = getAtPath(pending, ['effort']);
    const display = staged === undefined ? getAtPath(config, ['effort']) : staged;
    expect(display).toBe('fast');
  });

  it('display-value resolution: snapshot wins when nothing is staged at the path', () => {
    const config = { effort: 'balanced' };
    const pending: Record<string, unknown> = {};
    const staged = getAtPath(pending, ['effort']);
    const display = staged === undefined ? getAtPath(config, ['effort']) : staged;
    expect(display).toBe('balanced');
  });
});

/* ── Depth-1 flat / depth-2+ <details> structural contract ── */
describe('depth-1 flat / depth-2+ <details> structural contract (plan 01-03)', () => {
  it('AdvancedConfigSection.tsx renders <details> ONLY behind a `depth >= 1` Show gate', () => {
    // The renderer gates <details> with `<Show when={props.depth >= 1}
    // fallback={ <AdvancedConfigTree ... /> }>` — so when the parent
    // tree's depth is 0 (i.e. the immediate children are depth-1
    // entries, the top of the Advanced surface) the flat fallback
    // renders.
    //
    // Source-text assertion: the JSX `<details class=...` tag MUST exist
    // (depth-2+ allowance), AND the `<Show when={props.depth >= 1}` gate
    // MUST appear before it. The gate index < details index ordering
    // proves the gate wraps the details element.
    const showGateIdx = SOURCE.indexOf('when={props.depth >= 1}');
    const jsxDetailsIdx = SOURCE.indexOf('<details class=');
    expect(showGateIdx).toBeGreaterThanOrEqual(0);
    expect(jsxDetailsIdx).toBeGreaterThan(showGateIdx);
  });

  it('AdvancedConfigSection.tsx defines getAtPath + isPathStaged as exports', () => {
    expect(SOURCE).toMatch(/export\s+function\s+getAtPath/);
    expect(SOURCE).toMatch(/export\s+function\s+isPathStaged/);
  });

  it('AdvancedConfigSection.tsx has NO internal createSignal for edit state', () => {
    // The controlled-editor contract: NO internal state, parent owns
    // pendingEdits. Any `createSignal<` (with a generic to indicate
    // local state) inside this file would be a regression.
    expect(SOURCE).not.toMatch(/createSignal</);
  });

  it('AdvancedConfigSection.tsx has NO Edit/Cancel/Save buttons (controlled — those live at the Options level)', () => {
    // The component renders only the recursive tree + the empty
    // fallback. Any Edit/Cancel/Save string in JSX would be a
    // regression.
    expect(SOURCE).not.toMatch(/>\s*Edit\s*</);
    expect(SOURCE).not.toMatch(/>\s*Cancel\s*</);
    expect(SOURCE).not.toMatch(/>\s*Save\s*</);
  });
});

/* ── Component smoke + prop-shape assertion ── */
describe('AdvancedConfigSection component', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof AdvancedConfigSection).toBe('function');
  });

  it('accepts AdvancedConfigSectionProps-shaped props (compile-time prop-contract assertion)', () => {
    // A typed `const` — if `AdvancedConfigSectionProps` ever drops
    // `config` / `pendingEdits` / `onChange` or adds a required prop,
    // this stops compiling.
    const props: AdvancedConfigSectionProps = {
      config: { effort: 'balanced' },
      pendingEdits: {},
      onChange: () => {},
    };
    expect(typeof props.onChange).toBe('function');
  });
});
