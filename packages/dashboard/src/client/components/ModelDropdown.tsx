/**
 * `<ModelDropdown>` — the TopBar Model picker, alpha.35.
 *
 * Sits to the right of the Provider dropdown. Renders the available
 * models for the currently-selected provider; on user pick, writes the
 * model id to `config.model` via the existing applyConfigUpdate flow.
 *
 * Mirrors `ThemesDropdown` / `GithubDropdown` / `ProviderMenu`:
 *
 *   - **Open/close-CONTROLLED.** Parent (TopBar) owns the open signal,
 *     trigger ref, and focus-return on close. This component renders the
 *     popover body via the shared `<Popover>` primitive.
 *
 *   - **Data-CONTROLLED.** `currentProvider` + `currentModel` + `onSelect`
 *     flow in as props. Available models come from a local
 *     `createResource(fetchModels)` — Pi's registry is effectively static
 *     so a single fetch on mount is the right shape; no polling needed.
 *
 * Mounts in TopBar.tsx alongside the other chrome dropdowns. Independent
 * of the Themes/Github/Provider/Settings dropdowns — its own open signal,
 * its own trigger geometry, its own popover skin.
 */

import type { ModelInfo } from '@swt-labs/shared';
import { createResource, For, Show, type Component } from 'solid-js';

import { fetchModels } from '../services/api.js';

import { Popover } from './Popover.js';

export interface ModelDropdownProps {
  /** Open/close-controlled by the parent. */
  open: boolean;
  /** Called when the popover requests dismissal (Esc, click-outside, item-click). */
  onClose: () => void;
  /** The currently-selected provider id (from providerAuth snapshot). */
  currentProvider: string | null;
  /** The currently-selected model id (from `config.model`), or null when unset. */
  currentModel: string | null;
  /** Invoked with the chosen model id; parent wires to applyConfigUpdate. */
  onSelect: (modelId: string) => void;
}

export const ModelDropdown: Component<ModelDropdownProps> = (props) => {
  // Fetch once on mount. Pi's registry is effectively static — config.json
  // edits to providers.<id>.models are rare and don't warrant polling.
  const [models] = createResource<readonly ModelInfo[]>(async () => {
    const snapshot = await fetchModels();
    return snapshot.models;
  });

  // Filter to the currently-selected provider. When the provider is null
  // (no selection yet), show nothing — the dropdown's trigger remains
  // clickable but the body renders the empty-state hint.
  const providerModels = (): readonly ModelInfo[] => {
    const all = models() ?? [];
    if (props.currentProvider === null) return [];
    return all.filter((m) => m.provider === props.currentProvider);
  };

  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      role="menu"
      ariaLabel="Models"
      class="model-dropdown"
    >
      <Show
        when={models.loading}
        fallback={
          <Show
            when={providerModels().length > 0}
            fallback={
              <div class="model-dropdown-empty">
                <Show
                  when={props.currentProvider !== null}
                  fallback={<span>Pick a provider first to see available models.</span>}
                >
                  <span>No models available for {props.currentProvider}.</span>
                </Show>
              </div>
            }
          >
            <ul class="model-dropdown-menu" role="none">
              <For each={providerModels()}>
                {(m) => {
                  const isCurrent = (): boolean => props.currentModel === m.id;
                  return (
                    <li role="none">
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={isCurrent()}
                        class="model-dropdown-item"
                        classList={{ 'is-current': isCurrent() }}
                        onClick={(): void => {
                          props.onSelect(m.id);
                          props.onClose();
                        }}
                      >
                        <span class="model-dropdown-item-check" aria-hidden="true">
                          <Show
                            when={isCurrent()}
                            fallback={<span class="model-dropdown-item-check-empty">&nbsp;</span>}
                          >
                            ✓
                          </Show>
                        </span>
                        <span class="model-dropdown-item-body">
                          <span class="model-dropdown-item-label">{m.name ?? m.id}</span>
                          <Show when={m.contextWindow > 0 || m.reasoning}>
                            <span class="model-dropdown-item-description">
                              <Show when={m.contextWindow > 0}>
                                {formatContextWindow(m.contextWindow)}
                              </Show>
                              <Show when={m.contextWindow > 0 && m.reasoning}>{' · '}</Show>
                              <Show when={m.reasoning}>reasoning</Show>
                            </span>
                          </Show>
                        </span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        }
      >
        <div class="model-dropdown-empty">Loading models…</div>
      </Show>
    </Popover>
  );
};

/**
 * Pretty-print a context-window count as "200K" / "1M" / "128K" etc.
 * Exported for unit testability.
 */
export function formatContextWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K ctx`;
  return `${n} ctx`;
}
