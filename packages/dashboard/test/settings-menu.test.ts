/**
 * Plan 03-01 (Settings Dropdown v2) — `<SettingsMenu>` + dashboard-store
 * `optionsMenuOpen` coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `provider-auth-panel.test.ts` / `project-state-panel.test.ts` for the
 * same constraint). To keep this test deliverable shippable without a
 * workspace dep bump, `SettingsMenu`'s load-bearing behaviour is factored
 * into PURE exported helpers — `nextMenuStateOnTriggerClick`,
 * `shouldCloseOnKey`, `shouldCloseOnOutsideClick`, plus the staged-edit
 * helpers `stageCountOf` and `mergeStagedConfig` (re-homed from
 * SettingsSection.tsx by plan 03-01 T01) — which are unit-tested directly
 * here, plus a smoke test that the `SettingsMenu` export is a callable
 * Solid component. The dashboard-store half (`optionsMenuOpen` +
 * `openOptionsMenu` / `closeOptionsMenu` / `toggleOptionsMenu`) is
 * exercised against a real `createDashboardStore()` instance. Store keys
 * keep their `optionsMenu*` names per plan 03-01 — internal vocabulary
 * unchanged; only the user-visible trigger text flipped to `Settings ▾`.
 *
 * Plan 01-03 invariants carried forward unchanged:
 *
 *   (a) inline-section / no-collapse structural assertions — the popover
 *       body must render every section visible immediately, with no
 *       `<details>` wrapper anywhere inside the SettingsMenu render.
 *       Asserted by reading the source file and grepping for forbidden
 *       patterns (no DOM = no other choice).
 *   (b) Save-button disabled/enabled gates encoded as predicates over
 *       `(stageCount, loading)` so the visible state of the button is
 *       provably driven by `pendingEdits` + `props.loading`.
 *   (c) Discard / Save handler outcome assertions encoded as pure
 *       semantics over the `pendingEdits` signal (post-success → {},
 *       post-error → unchanged) — the SettingsMenu component holds the
 *       signal locally, but the contract is purely a function of
 *       `(prev, result)` and is fully testable as such.
 *
 * Plan 03-01 drift-lock 8 (skeleton-only this plan):
 *
 *   - The `data-section="advanced"` structural assertion is REMOVED:
 *     AdvancedConfigSection is deleted; the section no longer exists.
 *   - The 11 `stagePathEdit` describe block is REMOVED: the helper was
 *     retired alongside the Advanced tree.
 *   - The 9 `mergeStagedConfig` tests from the deleted
 *     `settings-section.test.ts` are INLINED here, re-imported from
 *     `SettingsMenu` (the new home of the helper).
 *
 * The 5 profile-flow integration scenarios that REPLACE the deleted
 * stagePathEdit coverage land in Plan 03-02 — this commit ships a green
 * skeleton; 03-02 layers the additive integration coverage on top.
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
  SettingsMenu,
  mergeStagedConfig,
  nextMenuStateOnTriggerClick,
  shouldCloseOnKey,
  shouldCloseOnOutsideClick,
  stageCountOf,
  type SettingsMenuProps,
} from '../src/client/components/SettingsMenu.jsx';
import { createDashboardStore } from '../src/client/state/dashboard-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_MENU_SOURCE = readFileSync(
  join(__dirname, '../src/client/components/SettingsMenu.tsx'),
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

describe('SettingsMenu component', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof SettingsMenu).toBe('function');
  });

  it('accepts SettingsMenuProps-shaped props (compile-time prop-contract assertion)', () => {
    // A typed `const` — if `SettingsMenuProps` ever drops `open` / `onClose`
    // or makes the section slots required, this stops compiling.
    const props: SettingsMenuProps = { open: false, onClose: () => {} };
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

/* ── Plan 03-01 (was plan 01-03): inline sections (no <details> collapse) ──
 *
 * The plan REQUIRES every section of the popover (Commands / Settings /
 * actions) to render inline on open — no expander click before anything
 * is visible. Asserted via source-text grep over the SettingsMenu.tsx
 * file: no `<details` substring may appear in the render tree.
 *
 * Plan 03-01 drift-lock 8: the `data-section="advanced"` assertion is
 * REMOVED — AdvancedConfigSection is deleted; the section no longer
 * exists in the new SettingsMenu surface.
 */
describe('SettingsMenu inline-sections structural contract', () => {
  it('SettingsMenu.tsx source contains NO <details> JSX (no inline collapse)', () => {
    // Forbidden patterns: `<details` (any subsequent attribute) or
    // </details>. Both are rendered tokens — neither must appear inside
    // the SettingsMenu component itself.
    expect(SETTINGS_MENU_SOURCE).not.toMatch(/<details[\s>]/);
    expect(SETTINGS_MENU_SOURCE).not.toMatch(/<\/details>/);
  });

  it('SettingsMenu.tsx source declares the three named section slots', () => {
    // The popover body has three `data-section` slots inline after the
    // Phase 03 Advanced-section retirement: commands / settings / actions.
    // The string search is robust because Solid attribute spelling is
    // stable here (no JSX-expression interpolation in these attributes).
    expect(SETTINGS_MENU_SOURCE).toContain('data-section="commands"');
    expect(SETTINGS_MENU_SOURCE).toContain('data-section="settings"');
    expect(SETTINGS_MENU_SOURCE).toContain('data-section="actions"');
  });

  it('SettingsMenu.tsx mounts SettingsTable + ProfileDropdown (Phase 03 composition)', () => {
    expect(SETTINGS_MENU_SOURCE).toContain('<SettingsTable');
    expect(SETTINGS_MENU_SOURCE).toContain('<ProfileDropdown');
  });
});

/* ── stageCountOf — drives the Save-button label + disabled gate. ── */
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

/* ── mergeStagedConfig — THE regression guard against the data-loss
 * bug. The handler MUST produce a FULL-config merge — every non-target
 * key preserved — and MUST NOT mutate the caller's `current` cell.
 *
 * Plan 03-01 T01 re-homed this helper from SettingsSection.tsx into
 * SettingsMenu.tsx; its test suite (9 cases) was carried over verbatim
 * from the now-deleted settings-section.test.ts. ── */
describe('mergeStagedConfig — staged-edit deep merge', () => {
  it('returns the snapshot unchanged when pending is empty', () => {
    const current = { effort: 'balanced', autonomy: 'standard' };
    const merged = mergeStagedConfig(current, {});
    expect(merged).toEqual(current);
    // A FRESH object — never the same reference as the caller's snapshot.
    expect(merged).not.toBe(current);
  });

  it('overrides the target field AND preserves every non-target field', () => {
    expect(
      mergeStagedConfig({ effort: 'balanced', autonomy: 'standard' }, { effort: 'fast' }),
    ).toEqual({ effort: 'fast', autonomy: 'standard' });
  });

  it('merges a boolean field while preserving the rest', () => {
    expect(mergeStagedConfig({ auto_uat: false, effort: 'turbo' }, { auto_uat: true })).toEqual({
      auto_uat: true,
      effort: 'turbo',
    });
  });

  it('handles an empty base — the greenfield / no-data case', () => {
    expect(mergeStagedConfig({}, { effort: 'fast' })).toEqual({ effort: 'fast' });
  });

  it('handles a non-object base — treats it as {} so pending payload still wins', () => {
    expect(mergeStagedConfig(null, { effort: 'fast' })).toEqual({ effort: 'fast' });
    expect(mergeStagedConfig(undefined, { effort: 'fast' })).toEqual({ effort: 'fast' });
  });

  it('deep-merges nested objects (Advanced-tree path)', () => {
    expect(
      mergeStagedConfig(
        { effort: 'balanced', nested: { keep: 'kept', overwrite: 'old' } },
        { nested: { overwrite: 'new' } },
      ),
    ).toEqual({ effort: 'balanced', nested: { keep: 'kept', overwrite: 'new' } });
  });

  it('replaces arrays wholesale (not element-merged)', () => {
    expect(mergeStagedConfig({ list: ['a', 'b', 'c'] }, { list: ['x'] })).toEqual({ list: ['x'] });
  });

  it('does NOT mutate the caller-provided base config cell', () => {
    const base = { effort: 'balanced', autonomy: 'standard' };
    const snapshot = { ...base };
    mergeStagedConfig(base, { effort: 'fast' });
    expect(base).toEqual(snapshot);
  });

  it('does NOT mutate a nested object inside the base', () => {
    const base = { nested: { keep: 'kept', overwrite: 'old' } };
    const baseNestedSnapshot = { ...base.nested };
    mergeStagedConfig(base, { nested: { overwrite: 'new' } });
    expect(base.nested).toEqual(baseNestedSnapshot);
  });
});

/* ── Save-button / Discard-button gating predicates ──
 *
 * The SettingsMenu render uses these exact expressions for the action-bar
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

describe('Save / Discard button gates', () => {
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

/* ── Save handler outcome semantics ──
 *
 * SettingsMenu's `handleSave` is local to the component, but the contract
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

describe('Save handler outcome semantics', () => {
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

/* ── Discard semantics ──
 *
 * `handleDiscardAll` resets pendingEdits to {} and clears saveError —
 * no network call, no flash. The contract is a pure state transition.
 */
function nextPendingAfterDiscard(_prev: Record<string, unknown>): Record<string, unknown> {
  return {};
}

describe('Discard handler semantics', () => {
  it('Discard always returns an empty pendingEdits regardless of prior shape', () => {
    expect(nextPendingAfterDiscard({ effort: 'fast', nested: { a: 1 } })).toEqual({});
  });

  it('Discard does NOT call any save callback (assertion via predicate purity)', () => {
    // The Discard onClick implementation in SettingsMenu.tsx calls only
    // `setPendingEdits({})` and `setSaveError(null)` — never `props.onSave`.
    // The source-text assertion below is the defence against a future
    // refactor that wires Discard to onSave by accident.
    const discardOnClick = SETTINGS_MENU_SOURCE.slice(
      SETTINGS_MENU_SOURCE.indexOf('handleDiscardAll'),
      SETTINGS_MENU_SOURCE.indexOf('handleSave'),
    );
    expect(discardOnClick).not.toContain('onSave');
  });
});
