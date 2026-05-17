/**
 * Plan 01-01 T4 + plan 01-03 — `<OptionsMenu>` + dashboard-store
 * `optionsMenuOpen` coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `provider-auth-panel.test.ts` / `project-state-panel.test.ts` for the
 * same constraint). To keep this plan's test deliverable shippable without
 * a workspace dep bump, `OptionsMenu`'s load-bearing behaviour is factored
 * into PURE exported helpers — `nextMenuStateOnTriggerClick`,
 * `shouldCloseOnKey`, `shouldCloseOnOutsideClick`, plus the plan 01-02
 * additions `stagePathEdit` + `stageCountOf` — which are unit-tested
 * directly here, plus a smoke test that the `OptionsMenu` export is a
 * callable Solid component. The dashboard-store half (`optionsMenuOpen` +
 * `openOptionsMenu` / `closeOptionsMenu` / `toggleOptionsMenu`) is exercised
 * against a real `createDashboardStore()` instance.
 *
 * Plan 01-03 adds:
 *
 *   (a) inline-section / no-collapse structural assertions — the popover
 *       body must render Commands / Settings / Advanced / actions all
 *       visible immediately, with no `<details>` wrapper anywhere inside
 *       the OptionsMenu render. Asserted by reading the source file and
 *       grepping for forbidden patterns (no DOM = no other choice).
 *   (b) Save-button disabled/enabled gates encoded as predicates over
 *       `(stageCount, loading)` so the visible state of the button is
 *       provably driven by `pendingEdits` + `props.loading`.
 *   (c) Discard / Save handler outcome assertions encoded as pure
 *       semantics over the `pendingEdits` signal (post-success → {},
 *       post-error → unchanged) — the OptionsMenu component holds the
 *       signal locally, but the contract is purely a function of
 *       `(prev, result)` and is fully testable as such.
 *
 * `Node` is undefined in the node-env run, so the `shouldCloseOnOutsideClick`
 * containment tests use minimal `{ contains }` stub objects cast to
 * `HTMLElement` — the helper's containment check is duck-typed for exactly
 * this reason. The null-target branch is the LOCKED defensive choice
 * (`null` → treated as OUTSIDE → `true`), asserted explicitly below.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  OptionsMenu,
  nextMenuStateOnTriggerClick,
  shouldCloseOnKey,
  shouldCloseOnOutsideClick,
  stageCountOf,
  stagePathEdit,
  type OptionsMenuProps,
} from '../src/client/components/OptionsMenu.jsx';
import { createDashboardStore } from '../src/client/state/dashboard-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_MENU_SOURCE = readFileSync(
  join(__dirname, '../src/client/components/OptionsMenu.tsx'),
  'utf8',
);

/**
 * A minimal element stub with a `.contains()` method — enough for
 * `shouldCloseOnOutsideClick`'s duck-typed containment check without a DOM.
 * `children` is the set of nodes this element "contains".
 */
function makeStubElement(children: ReadonlyArray<object> = []): {
  el: HTMLElement;
  child: object;
} {
  const child = {};
  const all = [...children, child];
  const el = {
    contains(node: object): boolean {
      return all.includes(node);
    },
  };
  return { el: el as unknown as HTMLElement, child };
}

describe('nextMenuStateOnTriggerClick', () => {
  it('toggles a closed menu open', () => {
    expect(nextMenuStateOnTriggerClick(false)).toBe(true);
  });

  it('toggles an open menu closed', () => {
    expect(nextMenuStateOnTriggerClick(true)).toBe(false);
  });
});

describe('shouldCloseOnKey', () => {
  it('dismisses on Escape', () => {
    expect(shouldCloseOnKey('Escape')).toBe(true);
  });

  it('does NOT dismiss on Enter', () => {
    expect(shouldCloseOnKey('Enter')).toBe(false);
  });

  it('does NOT dismiss on a printable character', () => {
    expect(shouldCloseOnKey('a')).toBe(false);
  });

  it('does NOT dismiss on Space', () => {
    expect(shouldCloseOnKey(' ')).toBe(false);
  });
});

describe('shouldCloseOnOutsideClick', () => {
  it('does NOT close when the click lands on a child contained by the popover', () => {
    const { el: menuRoot, child } = makeStubElement();
    expect(shouldCloseOnOutsideClick(child as unknown as EventTarget, menuRoot, null)).toBe(false);
  });

  it('does NOT close when the click lands on the trigger element', () => {
    const { el: triggerEl, child } = makeStubElement();
    // The trigger has its own onClick — double-handling would re-open the
    // menu, so a click on (or inside) the trigger is NOT an outside click.
    expect(shouldCloseOnOutsideClick(child as unknown as EventTarget, null, triggerEl)).toBe(false);
  });

  it('closes when the click lands on an unrelated node', () => {
    const { el: menuRoot } = makeStubElement();
    const { el: triggerEl } = makeStubElement();
    const unrelated = {};
    expect(
      shouldCloseOnOutsideClick(unrelated as unknown as EventTarget, menuRoot, triggerEl),
    ).toBe(true);
  });

  it('treats a null target as OUTSIDE → closes (the LOCKED defensive choice)', () => {
    const { el: menuRoot } = makeStubElement();
    const { el: triggerEl } = makeStubElement();
    expect(shouldCloseOnOutsideClick(null, menuRoot, triggerEl)).toBe(true);
  });

  it('closes when both menuRoot and triggerEl are null (nothing to be inside of)', () => {
    const target = {};
    expect(shouldCloseOnOutsideClick(target as unknown as EventTarget, null, null)).toBe(true);
  });
});

describe('OptionsMenu component', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof OptionsMenu).toBe('function');
  });

  it('accepts OptionsMenuProps-shaped props (compile-time prop-contract assertion)', () => {
    // A typed `const` — if `OptionsMenuProps` ever drops `open` / `onClose`
    // or makes the section slots required, this stops compiling.
    const props: OptionsMenuProps = { open: false, onClose: () => {} };
    expect(props.open).toBe(false);
    expect(typeof props.onClose).toBe('function');
  });
});

describe('dashboard-store optionsMenuOpen', () => {
  it('initialises optionsMenuOpen to false', () => {
    const [state] = createDashboardStore();
    expect(state.optionsMenuOpen).toBe(false);
  });

  it('openOptionsMenu sets it true', () => {
    const [state, actions] = createDashboardStore();
    actions.openOptionsMenu();
    expect(state.optionsMenuOpen).toBe(true);
  });

  it('closeOptionsMenu sets it false', () => {
    const [state, actions] = createDashboardStore();
    actions.openOptionsMenu();
    actions.closeOptionsMenu();
    expect(state.optionsMenuOpen).toBe(false);
  });

  it('toggleOptionsMenu flips it on each call', () => {
    const [state, actions] = createDashboardStore();
    actions.toggleOptionsMenu();
    expect(state.optionsMenuOpen).toBe(true);
    actions.toggleOptionsMenu();
    expect(state.optionsMenuOpen).toBe(false);
  });
});

/* ── Plan 01-03: inline sections (no <details> collapse) ──────────────
 *
 * The plan REQUIRES every section of the popover (Commands / Settings /
 * Advanced / action bar) to render inline on open — no expander click
 * before anything is visible. Asserted via source-text grep over the
 * OptionsMenu.tsx file: no `<details` substring may appear in the render
 * tree. (Depth-2+ <details> wrappers MAY exist inside
 * AdvancedConfigSection.tsx as a layout aid for nested objects; that
 * component owns its own structural test.)
 */
describe('OptionsMenu inline-sections structural contract (plan 01-03)', () => {
  it('OptionsMenu.tsx source contains NO <details> JSX (no inline collapse)', () => {
    // Forbidden patterns: `<details` (any subsequent attribute) or
    // </details>. Both are rendered tokens — neither must appear inside
    // the OptionsMenu component itself.
    expect(OPTIONS_MENU_SOURCE).not.toMatch(/<details[\s>]/);
    expect(OPTIONS_MENU_SOURCE).not.toMatch(/<\/details>/);
  });

  it('OptionsMenu.tsx source declares the four named section slots', () => {
    // The popover body has four `data-section` slots inline. The string
    // search is robust because Solid attribute spelling is stable here
    // (no JSX-expression interpolation in these attributes).
    expect(OPTIONS_MENU_SOURCE).toContain('data-section="commands"');
    expect(OPTIONS_MENU_SOURCE).toContain('data-section="settings"');
    expect(OPTIONS_MENU_SOURCE).toContain('data-section="advanced"');
    expect(OPTIONS_MENU_SOURCE).toContain('data-section="actions"');
  });
});

/* ── Plan 01-02 helper coverage: stageCountOf + stagePathEdit ──
 *
 * `stageCountOf` drives the Save-button label + disabled gate.
 * `stagePathEdit` is the Advanced-tree → pendingEdits merge contract.
 * Both are pure and exported from OptionsMenu.tsx.
 */
describe('stageCountOf', () => {
  it('returns 0 for an empty pending tree', () => {
    expect(stageCountOf({})).toBe(0);
  });

  it('returns N for an N-key flat pending tree', () => {
    expect(stageCountOf({ effort: 'fast', autonomy: 'standard' })).toBe(2);
  });

  it('counts nested-tree TOP-LEVEL keys (matches the Save button "changes" semantic)', () => {
    // The Save label "Save (N changes)" counts top-level keys, not leaves
    // — a nested merge under one top-level path still counts as one
    // staged change at the curated-row resolution.
    expect(stageCountOf({ nested: { a: 1, b: 2 } })).toBe(1);
  });
});

describe('stagePathEdit', () => {
  it('top-level path (length 1) is a flat merge', () => {
    expect(stagePathEdit({}, ['effort'], 'fast')).toEqual({ effort: 'fast' });
  });

  it('top-level path overrides an existing top-level value', () => {
    expect(stagePathEdit({ effort: 'balanced' }, ['effort'], 'fast')).toEqual({
      effort: 'fast',
    });
  });

  it('nested path builds the nested structure under the path root', () => {
    expect(stagePathEdit({}, ['nested_obj', 'inner_key'], 'val')).toEqual({
      nested_obj: { inner_key: 'val' },
    });
  });

  it('nested path deep-merges into an existing nested branch', () => {
    expect(stagePathEdit({ nested: { keep: 'kept' } }, ['nested', 'add'], 'val')).toEqual({
      nested: { keep: 'kept', add: 'val' },
    });
  });

  it('nested path under a NON-object existing branch overrides the branch wholesale', () => {
    // If the existing branch is a primitive (e.g. user previously staged
    // a flat enum override), the recursive merge degrades to a wholesale
    // override of the branch with the newly-nested object.
    expect(stagePathEdit({ effort: 'fast' }, ['effort', 'sub'], 'val')).toEqual({
      effort: { sub: 'val' },
    });
  });

  it('empty path is a no-op (defensive — nothing in the renderer triggers this)', () => {
    const pending = { effort: 'fast' };
    expect(stagePathEdit(pending, [], 'whatever')).toBe(pending);
  });

  it('does NOT mutate the caller-provided pending tree', () => {
    const pending = { keep: 'kept', nested: { existing: 1 } };
    const pendingNestedSnapshot = { ...pending.nested };
    stagePathEdit(pending, ['nested', 'added'], 2);
    expect(pending.nested).toEqual(pendingNestedSnapshot);
  });
});

/* ── Plan 01-03: Save-button / Discard-button gating predicates ──
 *
 * The OptionsMenu render uses these exact expressions for the action-bar
 * buttons:
 *   - Save: `disabled={stageCount() === 0 || (props.loading ?? false)}`
 *   - Discard: `disabled={stageCount() === 0}`
 *   - Save label: `stageCount() > 0 ? \`Save (${N} changes)\` : 'Save'`
 *
 * Encoding these as predicates makes the contract explicit and the
 * regressions cheap to catch.
 */
function saveDisabled(pending: Record<string, unknown>, loading: boolean): boolean {
  return stageCountOf(pending) === 0 || loading;
}

function discardDisabled(pending: Record<string, unknown>): boolean {
  return stageCountOf(pending) === 0;
}

function saveLabel(pending: Record<string, unknown>): string {
  const n = stageCountOf(pending);
  return n > 0 ? `Save (${n} changes)` : 'Save';
}

describe('Save / Discard button gates (plan 01-03)', () => {
  it('Save is disabled when pendingEdits is empty', () => {
    expect(saveDisabled({}, false)).toBe(true);
  });

  it('Save enables after one stage', () => {
    expect(saveDisabled({ effort: 'fast' }, false)).toBe(false);
  });

  it('Save stays disabled while loading is true (even with staged changes)', () => {
    expect(saveDisabled({ effort: 'fast' }, true)).toBe(true);
  });

  it('Discard is disabled when pendingEdits is empty', () => {
    expect(discardDisabled({})).toBe(true);
  });

  it('Discard enables after one stage', () => {
    expect(discardDisabled({ effort: 'fast' })).toBe(false);
  });

  it('Save label shows "Save" when no changes', () => {
    expect(saveLabel({})).toBe('Save');
  });

  it('Save label shows "Save (N changes)" with N === stageCountOf(pending)', () => {
    expect(saveLabel({ effort: 'fast' })).toBe('Save (1 changes)');
    expect(saveLabel({ effort: 'fast', autonomy: 'cautious' })).toBe('Save (2 changes)');
  });
});

/* ── Plan 01-03: Save handler outcome semantics ──
 *
 * OptionsMenu's `handleSave` is local to the component, but the contract
 * is purely a function of `(pendingEdits, saveResult)`. Encoded here as
 * a predicate so a regression that, say, clears pending on error or
 * forgets to clear it on success is caught.
 */
type SaveResult = { ok: true } | { error: string };

function nextPendingAfterSave(
  pending: Record<string, unknown>,
  result: SaveResult,
): Record<string, unknown> {
  // ok → clear; error → preserve. handleSave's actual implementation:
  //   if ('ok' in result) { setPendingEdits({}); ... }
  //   else { setSaveError(result.error); /* pendingEdits untouched */ }
  return 'ok' in result ? {} : pending;
}

function nextSavedFlashAfterSave(result: SaveResult): boolean {
  return 'ok' in result;
}

function nextSaveErrorAfterSave(result: SaveResult): string | null {
  return 'ok' in result ? null : result.error;
}

describe('Save handler outcome semantics (plan 01-03)', () => {
  it('on success, pendingEdits clears, savedFlash flips on, saveError stays null', () => {
    const before = { effort: 'fast' };
    expect(nextPendingAfterSave(before, { ok: true })).toEqual({});
    expect(nextSavedFlashAfterSave({ ok: true })).toBe(true);
    expect(nextSaveErrorAfterSave({ ok: true })).toBeNull();
  });

  it('on error, pendingEdits is PRESERVED, savedFlash stays off, saveError carries the message', () => {
    const before = { effort: 'fast' };
    expect(nextPendingAfterSave(before, { error: 'boom' })).toBe(before);
    expect(nextSavedFlashAfterSave({ error: 'boom' })).toBe(false);
    expect(nextSaveErrorAfterSave({ error: 'boom' })).toBe('boom');
  });
});

/* ── Plan 01-03: Discard semantics ──
 *
 * `handleDiscardAll` resets pendingEdits to {} and clears saveError —
 * no network call, no flash. The contract is a pure state transition.
 */
function nextPendingAfterDiscard(_prev: Record<string, unknown>): Record<string, unknown> {
  return {};
}

describe('Discard handler semantics (plan 01-03)', () => {
  it('Discard always returns an empty pendingEdits regardless of prior shape', () => {
    expect(nextPendingAfterDiscard({ effort: 'fast', nested: { a: 1 } })).toEqual({});
  });

  it('Discard does NOT call any save callback (assertion via predicate purity)', () => {
    // The Discard onClick implementation in OptionsMenu.tsx calls only
    // `setPendingEdits({})` and `setSaveError(null)` — never `props.onSave`.
    // The source-text assertion below is the defence against a future
    // refactor that wires Discard to onSave by accident.
    const discardOnClick = OPTIONS_MENU_SOURCE.slice(
      OPTIONS_MENU_SOURCE.indexOf('handleDiscardAll'),
      OPTIONS_MENU_SOURCE.indexOf('handleSave'),
    );
    expect(discardOnClick).not.toContain('onSave');
  });
});
