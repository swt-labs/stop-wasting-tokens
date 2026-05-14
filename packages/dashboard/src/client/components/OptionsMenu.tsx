/**
 * Plan 01-01 (Dashboard Options Menu — Phase 1) — the dropdown UI primitive
 * the dashboard does not have today.
 *
 * `OptionsMenu` is an open/close-CONTROLLED Solid component (mirrors
 * `CommandPaletteProps`'s `open` + `onClose` shape — it does NOT read the
 * dashboard store). `TopBar` owns the open/close state and the trigger
 * `ref`; this component only renders the popover, installs its document
 * listeners while open, and calls `props.onClose()` on dismissal.
 *
 * R1 (minimal purpose-built popover): no floating-ui / no menu library.
 * The popover is plain `position: absolute; top: 100%; right: 0;` inside a
 * `position: relative` `.options-menu-wrapper` that `TopBar` renders around
 * the trigger button — no portal, no collision-detection engine.
 *
 * R5 (accessibility/keyboard, in-scope for Phase 1): the popover has
 * `role="menu"` + `aria-label="Options"`, is dismissed on Escape and on a
 * click outside the popover-and-trigger, and receives focus on open (the
 * root is `tabindex={-1}`). Focus-RETURN to the trigger on close is owned by
 * `TopBar` (it holds the trigger `ref` and calls `.focus()` in its close
 * handler) — see the plan's `## Decisions`. This component therefore needs
 * no DOM-element prop.
 *
 * Load-bearing logic is factored into the exported pure helpers
 * (`nextMenuStateOnTriggerClick`, `shouldCloseOnKey`,
 * `shouldCloseOnOutsideClick`) so they can be unit-tested in the dashboard's
 * node-env vitest — the workspace has no `@solidjs/testing-library` (same
 * constraint documented in `provider-auth-panel.test.ts` /
 * `project-state-panel.test.ts`).
 *
 * The section-slot API (`commandsSection?` / `settingsSection?`) is the
 * contract Phases 2 & 3 chain off: Phase 2 mounts the real Settings content,
 * Phase 3 the real Commands content — neither restructures this component.
 */

import { Show, createEffect, onCleanup, type Component, type JSX } from 'solid-js';

/** Pure toggle for a trigger click. */
export function nextMenuStateOnTriggerClick(open: boolean): boolean {
  return !open;
}

/** True only when the key should dismiss the popover. */
export function shouldCloseOnKey(key: string): boolean {
  return key === 'Escape';
}

/**
 * True when an outside click should dismiss the popover. A click inside the
 * popover (`menuRoot`) OR on the trigger button is NOT an outside click —
 * the trigger has its own `onClick`; double-handling would immediately
 * re-open the menu.
 *
 * Null-target behaviour (LOCKED, see the plan's `## Decisions`): a `null` or
 * non-`Node` target is treated as OUTSIDE → returns `true`. A dismissal on
 * an ambiguous target is safer than a stuck-open menu.
 */
export function shouldCloseOnOutsideClick(
  target: EventTarget | null,
  menuRoot: HTMLElement | null,
  triggerEl: HTMLElement | null,
): boolean {
  if (!(target instanceof Node)) return true; // defensive: no element target → treat as outside
  if (menuRoot && menuRoot.contains(target)) return false;
  if (triggerEl && triggerEl.contains(target)) return false;
  return true;
}

export interface OptionsMenuProps {
  /** Open/close-controlled by the parent — OptionsMenu does NOT read the store. */
  open: boolean;
  /**
   * Called when the popover requests dismissal (Esc, click-outside). The
   * parent flips its open state false (and — per the plan's Decisions —
   * returns focus to the trigger).
   */
  onClose: () => void;
  /**
   * Phase 3 mounts the real Commands content here; omitted in Phase 1 → the
   * built-in skeleton placeholder renders.
   */
  commandsSection?: JSX.Element;
  /**
   * Phase 2 mounts the real Settings content here; omitted in Phase 1 → the
   * built-in skeleton placeholder renders.
   */
  settingsSection?: JSX.Element;
}

export const OptionsMenu: Component<OptionsMenuProps> = (props) => {
  let menuRoot: HTMLElement | undefined;

  const onDocClick = (e: MouseEvent): void => {
    if (shouldCloseOnOutsideClick(e.target, menuRoot ?? null, null)) {
      props.onClose();
    }
  };

  const onDocKey = (e: KeyboardEvent): void => {
    if (shouldCloseOnKey(e.key)) {
      e.preventDefault();
      props.onClose();
    }
  };

  /**
   * Document `click` + `keydown` listeners are installed ONLY while the
   * popover is open and torn down the moment it closes (and in `onCleanup`).
   *
   * The click listener is added on a `setTimeout(…, 0)` after open so the
   * very click that OPENED the menu — which is still bubbling up to
   * `document` when this effect runs — does not immediately dismiss it. The
   * trigger lives outside `menuRoot`, so without this defer `shouldClose…`
   * would see the opening click as an outside click and close instantly.
   */
  createEffect(() => {
    if (!props.open) return;
    let installed = false;
    const installTimer = setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onDocKey);
      installed = true;
    }, 0);
    // Move focus into the popover so keyboard users land inside it (R5).
    menuRoot?.focus();
    onCleanup(() => {
      clearTimeout(installTimer);
      if (installed) {
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onDocKey);
      }
    });
  });

  return (
    <Show when={props.open}>
      <div
        class="options-menu"
        role="menu"
        aria-label="Options"
        tabindex={-1}
        ref={(el): void => {
          menuRoot = el;
        }}
      >
        <section class="options-menu-section" data-section="commands">
          <h3 class="options-menu-section-heading">Commands</h3>
          <Show
            when={props.commandsSection}
            fallback={<p class="options-menu-skeleton">Coming soon — Phase 3</p>}
          >
            {props.commandsSection}
          </Show>
        </section>
        <section class="options-menu-section" data-section="settings">
          <h3 class="options-menu-section-heading">Settings</h3>
          <Show
            when={props.settingsSection}
            fallback={<p class="options-menu-skeleton">Coming soon — Phase 2</p>}
          >
            {props.settingsSection}
          </Show>
        </section>
      </div>
    </Show>
  );
};
