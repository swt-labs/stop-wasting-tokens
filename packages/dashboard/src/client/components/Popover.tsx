/**
 * `<Popover>` — the shared open/close-CONTROLLED dropdown popover primitive.
 *
 * Originally `OptionsMenu` was the dashboard's only dropdown and owned this
 * interaction code inline. The "Provider ▾" top-bar menu needs the exact
 * same mechanics (open/close, click-outside dismiss, Escape, focus-on-open,
 * `position: absolute` anchoring) so the fragile listener/dismiss logic is
 * factored HERE and consumed by both `OptionsMenu` and `ProviderMenu` —
 * rather than duplicating a block of subtle event handling.
 *
 * Like `OptionsMenu` was: this is open/close-CONTROLLED — it does NOT read
 * the dashboard store. The parent (`TopBar`) owns the open state + the
 * trigger `ref` and the focus-RETURN to that trigger on close; this
 * component only renders the popover, installs its document listeners while
 * open, and calls `props.onClose()` on dismissal.
 *
 * Accessibility: the popover root is `tabindex={-1}`, receives focus on
 * open, and takes a `role` + `ariaLabel` from the consumer (`OptionsMenu`
 * passes `role="menu"` / `aria-label="Options"`; `ProviderMenu` passes the
 * same shape for its own surface). It is dismissed on Escape and on a click
 * outside the popover-and-trigger.
 *
 * The load-bearing pure helpers (`nextMenuStateOnTriggerClick`,
 * `shouldCloseOnKey`, `shouldCloseOnOutsideClick`) live here so they can be
 * unit-tested in the dashboard's node-env vitest — the workspace has no
 * `@solidjs/testing-library`. `OptionsMenu` re-exports them unchanged so its
 * existing test imports keep resolving.
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
 * Null-target behaviour (LOCKED): a `null` or non-`Node` target is treated
 * as OUTSIDE → returns `true`. A dismissal on an ambiguous target is safer
 * than a stuck-open menu.
 */
export function shouldCloseOnOutsideClick(
  target: EventTarget | null,
  menuRoot: HTMLElement | null,
  triggerEl: HTMLElement | null,
): boolean {
  // A null / non-`Node` target is treated as OUTSIDE → returns `true`
  // (LOCKED). The `typeof Node` guard keeps this safe in the node-env
  // vitest run where `Node` is undefined — `target instanceof Node` would
  // otherwise throw. The containment check below is duck-typed on
  // `.contains()`, so the unit test can pass fake `{ contains }` stubs
  // without a DOM; in the browser `EventTarget` from a real click is always
  // a `Node` and `HTMLElement.contains` is native.
  if (target === null) return true;
  if (typeof Node !== 'undefined' && !(target instanceof Node)) return true;
  if (menuRoot && menuRoot.contains(target as unknown as Node)) return false;
  if (triggerEl && triggerEl.contains(target as unknown as Node)) return false;
  return true;
}

export interface PopoverProps {
  /** Open/close-controlled by the parent — Popover does NOT read the store. */
  open: boolean;
  /**
   * Called when the popover requests dismissal (Esc, click-outside). The
   * parent flips its open state false (and returns focus to the trigger).
   */
  onClose: () => void;
  /** The popover surface's ARIA role — e.g. `"menu"`. */
  role: string;
  /** The popover surface's accessible name. */
  ariaLabel: string;
  /** Extra class appended to the base `.popover` class (the consumer's skin). */
  class?: string;
  /** The popover body. */
  children: JSX.Element;
}

export const Popover: Component<PopoverProps> = (props) => {
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
   * very click that OPENED the popover — which is still bubbling up to
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
    // Move focus into the popover so keyboard users land inside it.
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
        class={props.class ? `popover ${props.class}` : 'popover'}
        role={props.role}
        aria-label={props.ariaLabel}
        tabindex={-1}
        ref={(el): void => {
          menuRoot = el;
        }}
      >
        {props.children}
      </div>
    </Show>
  );
};
