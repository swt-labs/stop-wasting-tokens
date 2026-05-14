/**
 * Phase 2 (Dashboard Options Menu) — the per-project Settings surface mounted
 * into `OptionsMenu`'s `settingsSection` slot.
 *
 * `SettingsSection` is a DEDICATED, fully-controlled Solid component with
 * `ConfigPanel`-shaped props (`data`/`loading`/`error`/`lastFetched`/`onRefresh`
 * + an `onApply(key, value)` round-trip). It renders one segmented control per
 * `SETTINGS_FIELD_ORDER` enum (current value highlighted, click-to-set) plus an
 * `auto_uat` toggle, mirroring `ConfigPanel`'s optimistic-apply + error-banner
 * behaviour (R4 — segmented-control affordance).
 *
 * It shares the store's `config` tools-cell with `ConfigPanel` via `App.tsx`
 * wiring (R3 coexist — both surfaces read `state.tools.config` + the same
 * `actions.applyConfigUpdate` action). The component itself does NOT read the
 * store: the parent owns the fetched `data` + the `onApply` round-trip; the
 * component owns only local UI signals (the in-flight field key + a per-apply
 * error string). This keeps it pure-props and node-env unit-testable — the
 * dashboard workspace has no `@solidjs/testing-library`.
 *
 * Load-bearing logic is factored into the exported pure helpers
 * (`currentSettingValue`, `isSegmentActive`, `buildConfigPatch`,
 * `nextBooleanValue`, `isFieldBusy`) so they can be unit-tested directly — the
 * same pattern as `ProviderAuthPanel` / `OptionsMenu`.
 */

import type { ConfigSnapshot } from '@swt-labs/shared';
import { For, Show, createSignal, type Component, type JSX } from 'solid-js';

import {
  CONFIG_ENUM_OPTIONS,
  SETTINGS_BOOLEAN_FIELDS,
  SETTINGS_FIELD_ORDER,
} from './config-enum-vocab.js';

/* ── pure helpers (load-bearing logic, unit-tested directly) ────────────── */

/** Read config[key] defensively — config may be null / non-object. */
export function currentSettingValue(
  config: unknown,
  key: string,
): string | boolean | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const v = (config as Record<string, unknown>)[key];
  return typeof v === 'string' || typeof v === 'boolean' ? v : undefined;
}

/** True when `value` is the currently-set value for `key` — highlights the active segment. */
export function isSegmentActive(config: unknown, key: string, value: string): boolean {
  return currentSettingValue(config, key) === value;
}

/**
 * The FULL-config-merge body passed to applyConfigUpdate. MUST merge the one
 * field into the complete current config — a single-key partial would be a
 * data-loss bug: `parseConfig` (ConfigSchema.safeParse, every key
 * `.default()`/`.optional()`) ACCEPTS `{ effort: 'fast' }` and returns a full
 * config with every OTHER field reset to its default + `marketplace`/`hooks`
 * dropped, and the /api/config route writes that `validated` object directly
 * with no merge. So the caller passes the live config cell as `base` and this
 * helper produces `{ config: { ...base, [key]: value } }` — a fresh object,
 * `base` is never mutated. This is the single tested merge point.
 */
export function buildConfigPatch(
  base: Record<string, unknown>,
  key: string,
  value: string | boolean,
): { config: Record<string, unknown> } {
  return { config: { ...base, [key]: value } };
}

/** Toggle helper for the auto_uat boolean field. */
export function nextBooleanValue(current: unknown): boolean {
  return !Boolean(current);
}

/** True while an onApply for `key` is in flight (pendingField holds the in-flight key). */
export function isFieldBusy(pendingField: string | null, key: string): boolean {
  return pendingField === key;
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
   * Click-to-set a single config field. The parent (App.tsx) wraps
   * `actions.applyConfigUpdate(buildConfigPatch(<live config cell>, key, value))`
   * — a FULL-config merge, NOT a single-key partial (a partial silently resets
   * every non-target field — a confirmed data-loss bug). The merge lives in the
   * App.tsx wiring; SettingsSection stays unaware of it and of the store.
   * Returns {ok:true} on success or {error} on failure — the section surfaces
   * the error inline.
   */
  onApply: (
    key: string,
    value: string | boolean,
  ) => Promise<{ ok: true } | { error: string }>;
}

/* ── component ──────────────────────────────────────────────────────────── */

export const SettingsSection: Component<SettingsSectionProps> = (props) => {
  const [pendingField, setPendingField] = createSignal<string | null>(null);
  const [applyError, setApplyError] = createSignal<string | null>(null);

  const sourceLabel = (): string =>
    props.data?.source === 'file' ? 'file' : props.data?.source === 'default' ? 'default' : '—';

  const handleApply = async (key: string, value: string | boolean): Promise<void> => {
    setPendingField(key);
    setApplyError(null);
    const result = await props.onApply(key, value);
    setPendingField(null);
    if ('error' in result) {
      setApplyError(result.error);
    }
  };

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
                <div class="settings-field-row">
                  <span class="settings-field-label">{key}</span>
                  <div class="settings-segment-group">
                    <For each={CONFIG_ENUM_OPTIONS[key] ?? []}>
                      {(value): JSX.Element => (
                        <button
                          type="button"
                          class="settings-segment"
                          classList={{
                            'settings-segment-active': isSegmentActive(
                              data().config,
                              key,
                              value,
                            ),
                          }}
                          aria-pressed={isSegmentActive(data().config, key, value)}
                          disabled={isFieldBusy(pendingField(), key) || props.loading}
                          onClick={(): void => {
                            if (!isSegmentActive(data().config, key, value)) {
                              void handleApply(key, value);
                            }
                          }}
                        >
                          {value}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
            <For each={SETTINGS_BOOLEAN_FIELDS}>
              {(key): JSX.Element => {
                const current = (): boolean | undefined => {
                  const v = currentSettingValue(data().config, key);
                  return typeof v === 'boolean' ? v : undefined;
                };
                return (
                  <div class="settings-field-row">
                    <span class="settings-field-label">{key}</span>
                    <div class="settings-segment-group">
                      <button
                        type="button"
                        class="settings-segment"
                        classList={{ 'settings-segment-active': current() === true }}
                        aria-pressed={current() === true}
                        disabled={isFieldBusy(pendingField(), key) || props.loading}
                        onClick={(): void => {
                          if (current() !== true) void handleApply(key, true);
                        }}
                      >
                        on
                      </button>
                      <button
                        type="button"
                        class="settings-segment"
                        classList={{ 'settings-segment-active': current() === false }}
                        aria-pressed={current() === false}
                        disabled={isFieldBusy(pendingField(), key) || props.loading}
                        onClick={(): void => {
                          if (current() !== false) void handleApply(key, false);
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
      <Show when={applyError() ?? props.error}>
        {(msg): JSX.Element => <p class="tools-panel-error">⚠ {msg()}</p>}
      </Show>
    </div>
  );
};
