/**
 * Plan 01-02 (Options Menu Consolidation) — the curated Settings surface
 * mounted into `OptionsMenu`'s body.
 *
 * `SettingsSection` is now a fully CONTROLLED Solid component (plan 01-02
 * flipped its semantics from immediate-apply to staged-edit). The component
 * no longer owns `onApply` round-trips; the parent (`OptionsMenu`) owns the
 * `pendingEdits` signal + the Save handler. This component just renders the
 * curated 10-key segmented controls + boolean toggle and notifies the parent
 * via `onStage(key, value)`.
 *
 * It still reads from `state.tools.config` via the `data`/`loading`/`error`/
 * `lastFetched` props (shared with `ConfigPanel` during the plan 01-02 →
 * 01-03 interim window). The component itself does NOT read the store: the
 * parent owns the fetched `data` + the staged-edit state; the component owns
 * only the display logic. This keeps it pure-props and node-env
 * unit-testable — the dashboard workspace has no `@solidjs/testing-library`.
 *
 * Load-bearing logic is factored into the exported pure helpers
 * (`currentSettingValue`, `resolveDisplayValue`, `isSegmentActive`,
 * `mergeStagedConfig`, `nextBooleanValue`) so they can be unit-tested
 * directly — the same pattern as `ProviderAuthPanel` / `OptionsMenu`. The
 * pre-01-02 `buildConfigPatch` back-compat alias was retired in plan 01-03
 * once the test suite migrated its assertions to `mergeStagedConfig`
 * directly.
 */

import type { ConfigSnapshot } from '@swt-labs/shared';
import { For, Show, type Component, type JSX } from 'solid-js';

import {
  CONFIG_ENUM_OPTIONS,
  SETTINGS_BOOLEAN_FIELDS,
  SETTINGS_FIELD_ORDER,
} from './config-enum-vocab.js';

/* ── pure helpers (load-bearing logic, unit-tested directly) ────────────── */

/** Read config[key] defensively — config may be null / non-object. */
export function currentSettingValue(config: unknown, key: string): string | boolean | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const v = (config as Record<string, unknown>)[key];
  return typeof v === 'string' || typeof v === 'boolean' ? v : undefined;
}

/**
 * Resolve the value to display for a curated key. Staged value (from
 * `pendingEdits[key]`) wins over the config snapshot. Mirrors the
 * `getAtPath` precedence used by `AdvancedConfigSection` for nested paths.
 */
export function resolveDisplayValue(
  config: unknown,
  pendingEdits: Record<string, unknown>,
  key: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(pendingEdits, key)) {
    return pendingEdits[key];
  }
  return currentSettingValue(config, key);
}

/**
 * True when `value` is the currently-displayed value for `key` — highlights
 * the active segment. Considers staged edits (pending) ahead of the snapshot.
 */
export function isSegmentActive(
  config: unknown,
  pendingEdits: Record<string, unknown>,
  key: string,
  value: string,
): boolean {
  return resolveDisplayValue(config, pendingEdits, key) === value;
}

/**
 * Deep-merge `pending` into `current` and return a fresh object. Used by
 * `OptionsMenu`'s Save handler to build the merged payload posted to
 * `applyConfigUpdate({ config: merged })`.
 *
 * THE merge MUST preserve every non-target field in `current` — a single-key
 * partial would be a data-loss bug. `parseConfig` (ConfigSchema.safeParse,
 * every key `.default()`/`.optional()`) ACCEPTS `{ effort: 'fast' }` and
 * returns a full config with every OTHER field reset to its default +
 * `marketplace`/`hooks` dropped, and the /api/config route writes the
 * validated object directly with no merge. So the caller passes the live
 * config cell as `current` and this helper produces a fresh merged object —
 * `current` is never mutated. This is the single tested merge point.
 *
 * Plain objects merge recursively; arrays + primitives are replaced
 * wholesale (matches the staged-edit semantics — a user editing an array
 * field replaces it). Non-object `current` is treated as `{}` so the
 * greenfield / no-data case still returns the pending payload.
 */
export function mergeStagedConfig(
  current: unknown,
  pending: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { ...base };
  for (const [key, pendingValue] of Object.entries(pending)) {
    const baseValue = out[key];
    if (
      typeof pendingValue === 'object' &&
      pendingValue !== null &&
      !Array.isArray(pendingValue) &&
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      out[key] = mergeStagedConfig(baseValue, pendingValue as Record<string, unknown>);
    } else {
      out[key] = pendingValue;
    }
  }
  return out;
}

/** Toggle helper for the auto_uat boolean field. */
export function nextBooleanValue(current: unknown): boolean {
  return !Boolean(current);
}

/**
 * Format an ISO-8601 timestamp as a relative-time string ("12s ago", "3m
 * ago", "1h ago"). Returns "—" when the input is null or invalid. Local copy
 * of `ConfigPanel`'s helper — acceptable for a leaf component.
 */
function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/* ── prop contract ──────────────────────────────────────────────────────── */

export interface SettingsSectionProps {
  /** The shared `config` tools-cell from the store — the SAME cell ConfigPanel reads. */
  data: ConfigSnapshot | null;
  loading: boolean;
  error: string | null;
  /** ISO-8601 timestamp of the last successful config fetch, or null. */
  lastFetched: string | null;
  onRefresh: () => void;
  /**
   * Parent-owned staged edits. Keys here override `data.config[key]` for the
   * curated rows. `OptionsMenu` owns this signal so it survives popover
   * close/open within a session. `{}` when nothing is staged.
   */
  pendingEdits: Record<string, unknown>;
  /**
   * Stage a new value for `key` (curated row click). The parent merges this
   * into its `pendingEdits` signal. NO network call from this component.
   */
  onStage: (key: string, value: string | boolean) => void;
  /**
   * Drop a staged key from `pendingEdits` (rarely called directly — Discard
   * at the Options level clears the whole signal). Kept for symmetry +
   * future per-row revert affordance.
   */
  onDiscardKey: (key: string) => void;
}

/* ── component ──────────────────────────────────────────────────────────── */

export const SettingsSection: Component<SettingsSectionProps> = (props) => {
  const sourceLabel = (): string =>
    props.data?.source === 'file' ? 'file' : props.data?.source === 'default' ? 'default' : '—';

  const isModified = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(props.pendingEdits, key);

  return (
    <div class="settings-section">
      <p class="settings-section-meta tools-panel-meta">
        Source: {sourceLabel()} · {formatRelative(props.lastFetched)}
        <button
          type="button"
          class="tools-refresh-btn settings-section-refresh"
          aria-label="Refresh config"
          disabled={props.loading}
          onClick={props.onRefresh}
        >
          ↻
        </button>
      </p>
      <Show
        when={props.data}
        fallback={
          <Show
            when={props.loading}
            fallback={<p class="tools-panel-empty">No config loaded yet.</p>}
          >
            <p class="tools-panel-empty">Loading…</p>
          </Show>
        }
      >
        {(data): JSX.Element => (
          <>
            <For each={SETTINGS_FIELD_ORDER}>
              {(key): JSX.Element => (
                <div
                  class="settings-field-row"
                  data-modified={isModified(key) ? 'true' : undefined}
                >
                  <span class="settings-field-label">{key}</span>
                  <div class="settings-segment-group" role="radiogroup" aria-label={key}>
                    <For each={CONFIG_ENUM_OPTIONS[key] ?? []}>
                      {(value): JSX.Element => {
                        const active = (): boolean =>
                          isSegmentActive(data().config, props.pendingEdits, key, value);
                        return (
                          <button
                            type="button"
                            class="settings-segment"
                            classList={{ 'settings-segment-active': active() }}
                            role="radio"
                            aria-checked={active()}
                            aria-label={`${key}: ${value}`}
                            onClick={(): void => {
                              if (!active()) props.onStage(key, value);
                            }}
                          >
                            {value}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
            <For each={SETTINGS_BOOLEAN_FIELDS}>
              {(key): JSX.Element => {
                const current = (): boolean | undefined => {
                  const v = resolveDisplayValue(data().config, props.pendingEdits, key);
                  return typeof v === 'boolean' ? v : undefined;
                };
                return (
                  <div
                    class="settings-field-row"
                    data-modified={isModified(key) ? 'true' : undefined}
                  >
                    <span class="settings-field-label">{key}</span>
                    <div class="settings-segment-group" role="radiogroup" aria-label={key}>
                      <button
                        type="button"
                        class="settings-segment"
                        classList={{ 'settings-segment-active': current() === true }}
                        role="radio"
                        aria-checked={current() === true}
                        aria-label={`${key}: on`}
                        onClick={(): void => {
                          if (current() !== true) props.onStage(key, true);
                        }}
                      >
                        on
                      </button>
                      <button
                        type="button"
                        class="settings-segment"
                        classList={{ 'settings-segment-active': current() === false }}
                        role="radio"
                        aria-checked={current() === false}
                        aria-label={`${key}: off`}
                        onClick={(): void => {
                          if (current() !== false) props.onStage(key, false);
                        }}
                      >
                        off
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </>
        )}
      </Show>
      <Show when={props.error}>
        {(msg): JSX.Element => <p class="tools-panel-error">⚠ {msg()}</p>}
      </Show>
    </div>
  );
};
