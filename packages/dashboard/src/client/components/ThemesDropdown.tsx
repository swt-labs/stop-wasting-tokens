/**
 * `<ThemesDropdown>` — the dashboard's theme picker.
 *
 * Mirrors `GithubDropdown` / `OptionsMenu` / `ProviderMenu`:
 *
 *   - **Open/close-CONTROLLED.** The parent (TopBar) owns the open signal
 *     + the trigger `ref` + focus-return on close. This component just
 *     renders the popover body via the shared `<Popover>` primitive.
 *
 *   - **Data-CONTROLLED.** `currentTheme` + `onSelect` flow in as props;
 *     the parent reads the dashboard store and dispatches the config
 *     save. `applyTheme` is invoked OPTIMISTICALLY here so the user sees
 *     the re-skin within a frame — before the round-trip to `/api/config`
 *     completes. If the save eventually fails, the SSE `state.changed`
 *     event would re-fetch the canonical config and the App-level
 *     createEffect would re-apply the truth.
 *
 *   - **Load-bearing data lives in `lib/themes-dropdown-helpers.ts`** —
 *     THEME_OPTIONS (the ordered 8 entries) and `applyTheme` (DOM helper).
 *     Pure and unit-testable in the node-env vitest run.
 */

import type { Theme } from '@swt-labs/core';
import { For, Show, type Component } from 'solid-js';

import { THEME_OPTIONS, applyTheme } from '../lib/themes-dropdown-helpers.js';

import { Popover } from './Popover.js';

export interface ThemesDropdownProps {
  /** Open/close-controlled by the parent — ThemesDropdown does NOT read the store. */
  open: boolean;
  /** Called when the popover requests dismissal (Esc, click-outside, item-click). */
  onClose: () => void;
  /** The currently-applied theme id from `state.tools.config.data?.config.theme`. */
  currentTheme: Theme;
  /**
   * Invoked with the newly-selected theme id when the user clicks an option.
   * The parent threads this to `actions.applyConfigUpdate({ config: { ..., theme } })`.
   * This component also calls `applyTheme(theme)` OPTIMISTICALLY before
   * invoking `onSelect`, so the visual re-skin doesn't wait on the round-trip.
   */
  onSelect: (theme: Theme) => void;
}

export const ThemesDropdown: Component<ThemesDropdownProps> = (props) => {
  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      role="menu"
      ariaLabel="Themes"
      class="themes-dropdown"
    >
      <ul class="themes-dropdown-menu" role="none">
        <For each={THEME_OPTIONS}>
          {(opt) => {
            const isCurrent = (): boolean => props.currentTheme === opt.id;
            return (
              <li role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent()}
                  class="themes-dropdown-item"
                  classList={{ 'is-current': isCurrent() }}
                  onClick={(): void => {
                    // Optimistic local apply — the user sees the re-skin
                    // immediately, well before /api/config has responded.
                    applyTheme(opt.id);
                    props.onSelect(opt.id);
                    props.onClose();
                  }}
                >
                  <span class="themes-dropdown-item-check" aria-hidden="true">
                    <Show
                      when={isCurrent()}
                      fallback={<span class="themes-dropdown-item-check-empty">&nbsp;</span>}
                    >
                      ✓
                    </Show>
                  </span>
                  <span class="themes-dropdown-item-body">
                    <span class="themes-dropdown-item-label">{opt.label}</span>
                    <span class="themes-dropdown-item-description">{opt.description}</span>
                  </span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </Popover>
  );
};
