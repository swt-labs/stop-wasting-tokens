/**
 * Phase 3 — `<ProviderAuthPanel>`: the dashboard's vendor-select panel.
 *
 * This is a DEDICATED panel, NOT an extension of `ConfigPanel` (research
 * §2). `ConfigPanel`'s generic `ConfigEditLeaf` only does
 * text/number/checkbox/enum-select — it has no concept of a WRITE-ONLY
 * secret input or an async submit, so the credential flow needs its own
 * component. It is a SIBLING of `ConfigPanel` / `DoctorPanel` in look +
 * props shape, so 03-04 wires it into `App.tsx`'s tools column the same
 * way.
 *
 * **Write-only secret invariant (load-bearing).** The panel NEVER receives
 * an API key from the server — `ProviderAuthSnapshot` is secret-free by
 * 03-01's schema construction. The `<input type="password">`'s value binds
 * ONLY to a local signal the user types into; on a SUCCESSFUL save the
 * panel CLEARS that signal so the entered key is not retained in component
 * state and is never re-displayed. The status display shows
 * `•••• configured`, never a key value. On a save FAILURE the input is
 * kept populated so the user can retry (mirrors `ConfigPanel`'s
 * keep-edit-mode-on-error behaviour).
 *
 * **Risk 6 (client half).** The provider dropdown options come from
 * `PROVIDER_VOCABULARY` imported via `@swt-labs/shared` — the client's
 * mirror of the provider list. NO `@swt-labs/runtime` dependency on the
 * client (the keychain module is server-only).
 *
 * **Risk 4 — read-only headless mode.** When `keychain_available === false`
 * the panel renders a "keychain unavailable" banner with env-var guidance
 * AND disables the key input + Save — the panel does not let the user
 * enter a key that cannot be persisted.
 *
 * **OAuth radio — rendered but disabled, pending Phase 4.** The OAuth
 * radio EXISTS (so the panel's shape is honest about what's coming) but is
 * `disabled` with a "coming in a future release" note. Selecting it (if it
 * were somehow enabled) does not enable Save and the client makes no OAuth
 * network call. Phase 4 un-stubs the radio + adds the OAuth flow.
 */

import { PROVIDER_VOCABULARY } from '@swt-labs/shared';
import { For, Show, createSignal, type Component, type JSX } from 'solid-js';

import type {
  ProviderAuthSnapshot,
  ProviderAuthStatus,
  ProviderAuthUpdateBody,
} from '../services/api.js';

export interface ProviderAuthPanelProps {
  data: ProviderAuthSnapshot | null;
  loading: boolean;
  error: string | null;
  /** ISO-8601 timestamp of the last successful fetch, or null. */
  lastFetched: string | null;
  onRefresh: () => void;
  /**
   * Invoked on Save. The parent wraps `postProviderAuth`. Returns
   * `{ok:true}` on success or `{error}` on failure — the panel surfaces
   * the error inline and keeps the key input populated for a retry.
   */
  onSave: (body: ProviderAuthUpdateBody) => Promise<{ ok: true } | { error: string }>;
}

/** The two auth modes the panel offers. `oauth` is rendered-but-disabled. */
export type PanelAuthMode = 'api_key' | 'oauth';

/**
 * Format an ISO-8601 timestamp as a relative-time string ("12s ago", "3m
 * ago", "1h ago"). Returns "—" when the input is null or invalid. Local
 * copy of `ConfigPanel`'s helper — a tiny leaf utility, cheaper to copy
 * than to factor a shared module for one more panel.
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Look up the per-provider status row for a provider id, or null. Pure —
 * exported so the panel's tests can assert the placeholder + status
 * derivation without a DOM renderer (the dashboard workspace has no Solid
 * testing-library; see `provider-auth-panel.test.ts`).
 */
export function findProviderStatus(
  data: ProviderAuthSnapshot | null,
  provider: string,
): ProviderAuthStatus | null {
  if (!data) return null;
  return data.statuses.find((s) => s.provider === provider) ?? null;
}

/**
 * The `type="password"` key input's placeholder. Reflects the current
 * status: when the selected provider is already `configured`, prompt for a
 * REPLACEMENT key; otherwise show the `sk-...` hint. Never contains a
 * secret — `ProviderAuthSnapshot` has none.
 */
export function keyInputPlaceholder(
  data: ProviderAuthSnapshot | null,
  provider: string,
): string {
  const status = findProviderStatus(data, provider);
  return status?.configured === true
    ? '••••• configured — enter a new key to replace'
    : 'sk-...';
}

/**
 * Whether the key input + Save button are locked. Risk 4: a headless host
 * with no keychain is read-only — the panel does not let the user enter a
 * key that cannot be persisted. `saving` also locks both during an
 * in-flight save.
 */
export function isInputLocked(data: ProviderAuthSnapshot | null, saving: boolean): boolean {
  return saving || data?.keychain_available === false;
}

/**
 * Whether the Save button is disabled. On top of `isInputLocked`, Save is
 * disabled when the selected mode is `oauth` — OAuth is Phase 4, the
 * client makes no OAuth network call, so selecting it (if it were enabled)
 * must never produce a Save.
 */
export function isSaveDisabled(
  data: ProviderAuthSnapshot | null,
  mode: PanelAuthMode,
  saving: boolean,
): boolean {
  return isInputLocked(data, saving) || mode === 'oauth';
}

/**
 * Build the `POST /api/provider-auth` body from the panel's local state.
 * Pure — exported so the tests lock the with-key / without-key contract
 * directly.
 *
 * `apiKey` is included ONLY when the mode is `api_key` AND the user
 * actually typed a (trimmed-non-empty) key. An empty input is a
 * RE-SELECTION — the user is re-pinning an already-configured provider and
 * wants to keep the existing keychain entry, so the body carries no
 * `apiKey` field at all (it is `.optional()` in 03-01's schema).
 */
export function buildAuthUpdateBody(
  provider: string,
  mode: PanelAuthMode,
  rawKeyInput: string,
): ProviderAuthUpdateBody {
  const trimmedKey = rawKeyInput.trim();
  return {
    provider,
    authMode: mode,
    ...(mode === 'api_key' && trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
  };
}

/** The status row's configured indicator text — never a key value. */
export function statusIndicatorLabel(configured: boolean): string {
  return configured ? '•••• configured' : 'not configured';
}

/* ── ProviderAuthPanel ──────────────────────────────────────────────── */

export const ProviderAuthPanel: Component<ProviderAuthPanelProps> = (props) => {
  const [selectedProvider, setSelectedProvider] = createSignal<string>(
    props.data?.selected_provider ?? PROVIDER_VOCABULARY[0],
  );
  const [selectedMode, setSelectedMode] = createSignal<PanelAuthMode>('api_key');
  // The ONLY place the entered API key lives. Bound to the password
  // <input>. Cleared on a successful save (write-only invariant).
  const [keyInput, setKeyInput] = createSignal<string>('');
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    const body = buildAuthUpdateBody(selectedProvider(), selectedMode(), keyInput());
    const result = await props.onSave(body);
    setSaving(false);
    if ('error' in result) {
      setSaveError(result.error);
      return; // keep the key input populated for a retry
    }
    // SUCCESS — clear the key input so the entered secret is not retained
    // in component state and is never re-displayed (write-only invariant).
    setKeyInput('');
  };

  return (
    <section class="panel tools-panel provider-auth-panel" aria-label="Provider Auth">
      <header class="tools-panel-header">
        <h2 class="panel-header">Provider Auth</h2>
        <div class="tools-panel-actions">
          <button
            type="button"
            class="tools-refresh-btn"
            aria-label="Refresh provider auth"
            disabled={props.loading}
            onClick={props.onRefresh}
          >
            ↻
          </button>
        </div>
      </header>
      <p class="tools-panel-meta">
        Strategy: {props.data?.strategy_kind ?? '—'} · {formatRelative(props.lastFetched)}
      </p>

      <Show when={props.data?.keychain_available === false}>
        <p class="provider-auth-banner tools-panel-banner">
          OS keychain not available on this host
          {props.data?.keychain_reason ? ` (${props.data.keychain_reason})` : ''} — set
          ANTHROPIC_API_KEY etc. in your environment to authenticate.
        </p>
      </Show>

      <Show when={props.data?.strategy_kind && props.data.strategy_kind !== 'pinned'}>
        <p class="provider-auth-banner tools-panel-banner">
          Provider strategy is "{props.data?.strategy_kind}" — the dropdown drives the pinned
          provider only.
        </p>
      </Show>

      <div class="provider-auth-field">
        <label class="provider-auth-field-label" for="provider-auth-provider">
          Provider
        </label>
        <select
          id="provider-auth-provider"
          class="provider-auth-select"
          value={selectedProvider()}
          disabled={saving()}
          onChange={(e): void => {
            setSelectedProvider(e.currentTarget.value);
          }}
        >
          <For each={PROVIDER_VOCABULARY}>
            {(provider): JSX.Element => <option value={provider}>{provider}</option>}
          </For>
        </select>
      </div>

      <div class="provider-auth-field">
        <span class="provider-auth-field-label">Auth mode</span>
        <div class="provider-auth-radio-group" role="radiogroup" aria-label="Auth mode">
          <label class="provider-auth-radio">
            <input
              type="radio"
              name="provider-auth-mode"
              value="api_key"
              checked={selectedMode() === 'api_key'}
              disabled={saving()}
              onChange={(): void => {
                setSelectedMode('api_key');
              }}
            />
            API key
          </label>
          <label class="provider-auth-radio provider-auth-radio-disabled">
            <input
              type="radio"
              name="provider-auth-mode"
              value="oauth"
              checked={selectedMode() === 'oauth'}
              disabled
              onChange={(): void => {
                setSelectedMode('oauth');
              }}
            />
            OAuth
            <span class="provider-auth-coming-soon">OAuth login — coming in a future release</span>
          </label>
        </div>
      </div>

      <Show when={selectedMode() === 'api_key'}>
        <div class="provider-auth-field">
          <label class="provider-auth-field-label" for="provider-auth-key">
            API key
          </label>
          <input
            id="provider-auth-key"
            type="password"
            class="provider-auth-key-input"
            autocomplete="off"
            placeholder={keyInputPlaceholder(props.data, selectedProvider())}
            value={keyInput()}
            disabled={isInputLocked(props.data, saving())}
            onInput={(e): void => {
              setKeyInput(e.currentTarget.value);
            }}
          />
        </div>
      </Show>

      <div class="provider-auth-actions">
        <button
          type="button"
          class="provider-auth-save-btn"
          disabled={isSaveDisabled(props.data, selectedMode(), saving())}
          onClick={(): void => void handleSave()}
        >
          {saving() ? 'Saving…' : 'Save'}
        </button>
      </div>

      <Show when={saveError() ?? props.error}>
        {(message): JSX.Element => <p class="tools-panel-error">⚠ {message()}</p>}
      </Show>

      <Show
        when={props.data}
        fallback={
          <Show
            when={props.loading}
            fallback={<p class="tools-panel-empty">No provider auth loaded yet.</p>}
          >
            <p class="tools-panel-empty">Loading…</p>
          </Show>
        }
      >
        {(data): JSX.Element => (
          <div class="provider-auth-status-list" aria-label="Provider auth status">
            <For
              each={data().statuses}
              fallback={<p class="tools-panel-empty">No providers configured yet.</p>}
            >
              {(status): JSX.Element => (
                <div class="provider-auth-status-row">
                  <span class="provider-auth-status-provider">{status.provider}</span>
                  <span
                    class={`provider-auth-status-indicator provider-auth-status-${
                      status.configured ? 'on' : 'off'
                    }`}
                  >
                    {statusIndicatorLabel(status.configured)}
                  </span>
                  <Show when={status.source}>
                    <span class="provider-auth-status-source">{status.source}</span>
                  </Show>
                  <Show when={status.label}>
                    <span class="provider-auth-status-label">{status.label}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </section>
  );
};
