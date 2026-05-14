/**
 * Plan 01-01 (Dashboard Options Menu — Phase 1) — the dropdown UI primitive
 * the dashboard did not have before.
 *
 * `OptionsMenu` is an open/close-CONTROLLED Solid component. `TopBar` owns
 * the open/close state and the trigger `ref`; this component only renders
 * the popover body. The popover MECHANICS (document listeners while open,
 * Escape / click-outside dismissal, focus-on-open, `position: absolute`
 * anchoring) now live in the shared `<Popover>` primitive — `ProviderMenu`
 * uses the same primitive so the fragile interaction code is written once.
 *
 * The load-bearing pure helpers (`nextMenuStateOnTriggerClick`,
 * `shouldCloseOnKey`, `shouldCloseOnOutsideClick`) moved to `Popover.tsx`;
 * they are RE-EXPORTED here unchanged so existing `options-menu.test.ts`
 * imports keep resolving.
 *
 * The section-slot API (`commandsSection?` / `settingsSection?`) is the
 * contract Phases 2 & 3 chain off: Phase 2 mounts the real Settings content,
 * Phase 3 the real Commands content — neither restructures this component.
 */

import { Show, type Component, type JSX } from 'solid-js';

import { Popover } from './Popover.js';

// Re-exported for back-compat: `options-menu.test.ts` imports these helpers
// from this module. Their implementation lives in `Popover.tsx`.
export {
  nextMenuStateOnTriggerClick,
  shouldCloseOnKey,
  shouldCloseOnOutsideClick,
} from './Popover.js';

export interface OptionsMenuProps {
  /** Open/close-controlled by the parent — OptionsMenu does NOT read the store. */
  open: boolean;
  /**
   * Called when the popover requests dismissal (Esc, click-outside). The
   * parent flips its open state false (and returns focus to the trigger).
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
  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      role="menu"
      ariaLabel="Options"
      class="options-menu"
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
    </Popover>
  );
};
