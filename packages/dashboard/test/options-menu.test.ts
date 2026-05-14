/**
 * Plan 01-01 T4 — `<OptionsMenu>` + dashboard-store `optionsMenuOpen` coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `provider-auth-panel.test.ts` / `project-state-panel.test.ts` for the
 * same constraint). To keep this plan's test deliverable shippable without
 * a workspace dep bump, `OptionsMenu`'s load-bearing behaviour is factored
 * into PURE exported helpers — `nextMenuStateOnTriggerClick`,
 * `shouldCloseOnKey`, `shouldCloseOnOutsideClick` — which are unit-tested
 * directly here, plus a smoke test that the `OptionsMenu` export is a
 * callable Solid component. The dashboard-store half (`optionsMenuOpen` +
 * `openOptionsMenu` / `closeOptionsMenu` / `toggleOptionsMenu`) is exercised
 * against a real `createDashboardStore()` instance.
 *
 * `Node` is undefined in the node-env run, so the `shouldCloseOnOutsideClick`
 * containment tests use minimal `{ contains }` stub objects cast to
 * `HTMLElement` — the helper's containment check is duck-typed for exactly
 * this reason. The null-target branch is the LOCKED defensive choice
 * (`null` → treated as OUTSIDE → `true`), asserted explicitly below.
 */

import { describe, expect, it } from 'vitest';

import {
  OptionsMenu,
  nextMenuStateOnTriggerClick,
  shouldCloseOnKey,
  shouldCloseOnOutsideClick,
  type OptionsMenuProps,
} from '../src/client/components/OptionsMenu.jsx';
import { createDashboardStore } from '../src/client/state/dashboard-store.js';

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
