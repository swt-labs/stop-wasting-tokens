/**
 * `<GithubDropdown>` — milestone 20 phase 01 chrome-row dropdown.
 *
 * Surfaces the project's most common Github-flavoured actions (bug reports,
 * open PRs / issues / CI, SWT docs / changelog) from a single trigger in a
 * new `.chrome-row` above the existing TopBar. This phase ships UI
 * scaffolding only — no item is wired (every enabled click is a
 * `console.debug` stub). Per-item wiring is per-item Future Work.
 *
 * Architectural notes:
 *
 *   - **Open/close-CONTROLLED.** App.tsx owns the open signal + the trigger
 *     `ref` and the focus-return on close. This component renders the
 *     popover body via the shared `<Popover>` primitive — same shape as
 *     `OptionsMenu` / `ProviderMenu`.
 *
 *   - **NO native disclosure shell.** The brief's component sketch used a
 *     native HTML disclosure element, but the codebase canon is `<Popover>`
 *     (Scout DRIFT-1). Click-outside / Escape / focus-on-open all come
 *     from `Popover.tsx`'s document listeners; this component just renders
 *     the body.
 *
 *   - **Load-bearing logic lives in `lib/github-dropdown-helpers.ts`.** The
 *     8-item menu shape, the disabled-tooltip string, the section grouper,
 *     and the `hasGithubRemote()` URL-param stub are all pure exports there
 *     — unit-tested directly in the node-env vitest run.
 *
 *   - **Disabled items.** When `props.hasGithubRemote` is false, the 5
 *     `needsRemote: true` items render visually-disabled (`.is-disabled`
 *     class → reduced opacity + `cursor: not-allowed`), with `aria-disabled`
 *     true and a `title` tooltip explaining why. Their `onClick` is a
 *     no-op — the click guard lives inline on the `<li>`.
 */

import { For, Show, type Component } from 'solid-js';

import {
  GITHUB_MENU_ITEMS,
  SECTION_LABELS,
  getDisabledTooltip,
  groupItemsBySection,
  type GithubMenuItem,
} from '../lib/github-dropdown-helpers.js';

import { Popover } from './Popover.js';

export interface GithubDropdownProps {
  /** Open/close-controlled by the parent — GithubDropdown does NOT read the store. */
  open: boolean;
  /** Called when the popover requests dismissal (Esc, click-outside). */
  onClose: () => void;
  /**
   * Click handler for an enabled menu item. v1 callers pass a
   * `console.debug` stub; per-item wiring is per-item Future Work. Disabled
   * items never invoke this callback (the `<li>` `onClick` guards on
   * `isDisabled(item)`).
   */
  onItemClick: (item: GithubMenuItem) => void;
  /**
   * Whether the current project has a GitHub remote. Drives the disabled
   * state of items 2-6 (the 5 `needsRemote: true` items). v1 callers pass
   * `hasGithubRemote()` from the helper module; Tier-2 wiring replaces it
   * with real discovery.
   */
  hasGithubRemote: boolean;
}

export const GithubDropdown: Component<GithubDropdownProps> = (props) => {
  const isDisabled = (item: GithubMenuItem): boolean => item.needsRemote && !props.hasGithubRemote;

  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      role="menu"
      ariaLabel="Github"
      class="github-dropdown"
    >
      <ul class="github-dropdown-menu">
        <For each={groupItemsBySection(GITHUB_MENU_ITEMS)}>
          {([section, items], idx): ReturnType<Component> => (
            <>
              <Show when={idx() > 0}>
                <li class="github-dropdown-divider" role="separator" />
              </Show>
              <li class="github-dropdown-section-label">{SECTION_LABELS[section]}</li>
              <For each={items}>
                {(item): ReturnType<Component> => (
                  <li
                    role="menuitem"
                    classList={{
                      'github-dropdown-item': true,
                      'is-disabled': isDisabled(item),
                    }}
                    aria-disabled={isDisabled(item)}
                    title={isDisabled(item) ? getDisabledTooltip() : undefined}
                    onClick={(): void => {
                      if (!isDisabled(item)) {
                        props.onItemClick(item);
                      }
                    }}
                  >
                    {item.label}
                  </li>
                )}
              </For>
            </>
          )}
        </For>
      </ul>
    </Popover>
  );
};
