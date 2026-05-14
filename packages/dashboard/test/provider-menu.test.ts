/**
 * `<ProviderMenu>` + `<Popover>` + dashboard-store `providerMenuOpen` coverage.
 *
 * The dashboard workspace has no Solid testing-library and vitest runs
 * `environment: 'node'` (see `options-menu.test.ts` / `provider-auth-panel.test.ts`
 * for the same constraint). So this covers:
 *
 *   - the shared `<Popover>` primitive's pure helpers
 *     (`nextMenuStateOnTriggerClick`, `shouldCloseOnKey`,
 *     `shouldCloseOnOutsideClick`) — re-tested at their new home after the
 *     extraction from `OptionsMenu`,
 *   - smoke tests that `Popover` + `ProviderMenu` are callable Solid
 *     components with the expected prop contracts,
 *   - the dashboard-store `providerMenuOpen` field + its
 *     `openProviderMenu` / `closeProviderMenu` / `toggleProviderMenu`
 *     actions, exercised against a real `createDashboardStore()`,
 *   - the independence of the two TopBar dropdowns (toggling Provider does
 *     not move Options, and vice-versa).
 */

import { describe, expect, it } from 'vitest';

import {
  Popover,
  nextMenuStateOnTriggerClick,
  shouldCloseOnKey,
  shouldCloseOnOutsideClick,
  type PopoverProps,
} from '../src/client/components/Popover.jsx';
import { ProviderMenu, type ProviderMenuProps } from '../src/client/components/ProviderMenu.jsx';
import { createDashboardStore } from '../src/client/state/dashboard-store.js';

/**
 * A minimal element stub with a `.contains()` method — enough for
 * `shouldCloseOnOutsideClick`'s duck-typed containment check without a DOM.
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

/* ── shared <Popover> pure helpers (moved here from OptionsMenu) ───────── */

describe('nextMenuStateOnTriggerClick', () => {
  it('toggles a closed popover open', () => {
    expect(nextMenuStateOnTriggerClick(false)).toBe(true);
  });

  it('toggles an open popover closed', () => {
    expect(nextMenuStateOnTriggerClick(true)).toBe(false);
  });
});

describe('shouldCloseOnKey', () => {
  it('dismisses on Escape', () => {
    expect(shouldCloseOnKey('Escape')).toBe(true);
  });

  it('does NOT dismiss on Enter / printable / Space', () => {
    expect(shouldCloseOnKey('Enter')).toBe(false);
    expect(shouldCloseOnKey('a')).toBe(false);
    expect(shouldCloseOnKey(' ')).toBe(false);
  });
});

describe('shouldCloseOnOutsideClick', () => {
  it('does NOT close on a click contained by the popover', () => {
    const { el: menuRoot, child } = makeStubElement();
    expect(shouldCloseOnOutsideClick(child as unknown as EventTarget, menuRoot, null)).toBe(false);
  });

  it('does NOT close on a click on the trigger element', () => {
    const { el: triggerEl, child } = makeStubElement();
    expect(shouldCloseOnOutsideClick(child as unknown as EventTarget, null, triggerEl)).toBe(false);
  });

  it('closes on a click on an unrelated node', () => {
    const { el: menuRoot } = makeStubElement();
    const { el: triggerEl } = makeStubElement();
    expect(shouldCloseOnOutsideClick({} as unknown as EventTarget, menuRoot, triggerEl)).toBe(true);
  });

  it('treats a null target as OUTSIDE → closes (the LOCKED defensive choice)', () => {
    expect(shouldCloseOnOutsideClick(null, null, null)).toBe(true);
  });
});

/* ── component smoke tests ────────────────────────────────────────────── */

describe('<Popover>', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof Popover).toBe('function');
  });

  it('accepts PopoverProps-shaped props (compile-time prop-contract assertion)', () => {
    // If PopoverProps ever drops `open` / `onClose` / `role` / `ariaLabel` /
    // `children`, this stops compiling.
    const props: PopoverProps = {
      open: false,
      onClose: () => {},
      role: 'menu',
      ariaLabel: 'Provider',
      children: null,
    };
    expect(props.open).toBe(false);
    expect(props.role).toBe('menu');
  });
});

describe('<ProviderMenu>', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof ProviderMenu).toBe('function');
  });

  it('accepts ProviderMenuProps-shaped props (children-slot prop contract)', () => {
    // ProviderMenu takes the panel as a JSX `children` slot — NOT a flat
    // props object — so the panel's reactive store bindings survive the
    // hand-off. If that contract regresses, this stops compiling.
    const props: ProviderMenuProps = { open: true, onClose: () => {}, children: null };
    expect(props.open).toBe(true);
    expect(typeof props.onClose).toBe('function');
  });
});

/* ── dashboard-store providerMenuOpen ─────────────────────────────────── */

describe('dashboard-store providerMenuOpen', () => {
  it('initialises providerMenuOpen to false', () => {
    const [state] = createDashboardStore();
    expect(state.providerMenuOpen).toBe(false);
  });

  it('openProviderMenu sets it true', () => {
    const [state, actions] = createDashboardStore();
    actions.openProviderMenu();
    expect(state.providerMenuOpen).toBe(true);
  });

  it('closeProviderMenu sets it false', () => {
    const [state, actions] = createDashboardStore();
    actions.openProviderMenu();
    actions.closeProviderMenu();
    expect(state.providerMenuOpen).toBe(false);
  });

  it('toggleProviderMenu flips it on each call', () => {
    const [state, actions] = createDashboardStore();
    actions.toggleProviderMenu();
    expect(state.providerMenuOpen).toBe(true);
    actions.toggleProviderMenu();
    expect(state.providerMenuOpen).toBe(false);
  });

  it('the Provider + Options dropdowns are independent store flags', () => {
    // Each TopBar dropdown owns its own click-outside dismissal — opening
    // one must not move the other.
    const [state, actions] = createDashboardStore();
    actions.openProviderMenu();
    expect(state.providerMenuOpen).toBe(true);
    expect(state.optionsMenuOpen).toBe(false);
    actions.openOptionsMenu();
    actions.closeProviderMenu();
    expect(state.providerMenuOpen).toBe(false);
    expect(state.optionsMenuOpen).toBe(true);
  });
});
