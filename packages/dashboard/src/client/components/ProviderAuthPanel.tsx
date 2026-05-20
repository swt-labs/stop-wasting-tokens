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
 * **OAuth radio — un-stubbed in Phase 4 (plan 04-03).** Phase 3 shipped the
 * OAuth radio disabled with a coming-later note. Plan 04-03 removes that
 * stub and makes the radio selectable for the three providers pi-ai ships
 * an OAuth subsystem for (`anthropic` / `openai` / `github-copilot`, listed
 * here as SWT user-facing canonical ids — see `OAUTH_PROVIDERS` below for
 * the SWT-vs-pi-ai id-convention note) — a provider not in pi-ai's OAuth
 * registry has no OAuth option. The radio stays disabled when the keychain
 * is unavailable (an OAuth login also culminates in a keychain write) OR
 * the selected provider has no OAuth support.
 *
 * **Risk 4 — auth URL shown ALWAYS + manual-code paste box.** When an OAuth
 * flow is active, the panel renders the auth URL from the `oauth.auth_url`
 * event UNCONDITIONALLY (not just headless) plus, on `oauth.awaiting_code`,
 * a manual-code paste box wired to `onSubmitOAuthCode`. The paste box is the
 * always-available fallback — pi-ai's `onManualCodeInput` races its own
 * browser-callback server, so on a host where the callback works the user
 * never needs it; no host-environment detection. The panel NEVER displays,
 * stores, or transports a token: the `oauthFlow` prop is token-free by
 * construction, the manual-code `codeInput` local signal is cleared on a
 * successful submit, the auth URL is rendered as a plain href/text node
 * (no raw-HTML sink), and the panel makes no direct OAuth network call.
 */

import { PROVIDER_VOCABULARY } from '@swt-labs/shared';
import { For, Match, Show, Switch, createSignal, type Component, type JSX } from 'solid-js';

import type {
  ProviderAuthSnapshot,
  ProviderAuthStatus,
  ProviderAuthUpdateBody,
} from '../services/api.js';
import type { OAuthFlowState } from '../state/dashboard-store.js';

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
  /**
   * Plan 04-03 (Phase 4) — the in-progress OAuth login flow, or `null` when
   * no OAuth login is running. Token-free by construction. App.tsx passes
   * the dashboard-store's `oauthFlow` signal here.
   *
   * The four OAuth props are OPTIONAL: plan 04-03 ships the panel + store +
   * api surface, and 04-04 completes the trivial App.tsx prop-passing
   * extension (per the Phase 4 OVERVIEW — "04-04 completes the App.tsx
   * wiring 04-03 deferred"). Optional keeps App.tsx compiling unchanged in
   * the 04-03 → 04-04 window; the panel degrades gracefully (the OAuth
   * radio falls back to disabled, the Login button is a no-op) until the
   * wiring lands. See 04-03-SUMMARY DEVN-02.
   */
  oauthFlow?: OAuthFlowState | null;
  /** Kick off an OAuth login for the selected provider (wraps `postOAuthStart`). */
  onStartOAuth?: (provider: string) => Promise<{ ok: true } | { error: string }>;
  /** Submit a manually-pasted authorization code — Risk 4 headless path (wraps `postOAuthCode`). */
  onSubmitOAuthCode?: (code: string) => Promise<{ ok: true } | { error: string }>;
  /** Clear the OAuth flow state — the 'Done' / 'Dismiss' affordance. */
  onDismissOAuthFlow?: () => void;
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
export function keyInputPlaceholder(data: ProviderAuthSnapshot | null, provider: string): string {
  const status = findProviderStatus(data, provider);
  return status?.configured === true ? '••••• configured — enter a new key to replace' : 'sk-...';
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
 * The providers SWT exposes an OAuth login path for. Lists SWT user-facing
 * canonical provider ids (members of `PROVIDER_VOCABULARY`) — NOT pi-ai's
 * internal registry ids (e.g. pi-ai 0.74.0 keys OpenAI Codex under
 * `'openai-codex'`, but SWT speaks `'openai'` end-to-end; the dashboard
 * OAuth-start route translates once via `mapToOAuthProviderId` from
 * `@swt-labs/runtime` — milestone 21 Phase 01).
 *
 * `isOAuthRadioDisabled` (below) gates the OAuth auth-mode radio on
 * membership in this array AND keychain availability (Phase 4 OVERVIEW
 * Scope Boundary).
 */
export const OAUTH_PROVIDERS: readonly string[] = ['anthropic', 'openai', 'github-copilot'];

/** Whether `provider` has a pi-ai OAuth subsystem (plan 04-03). Pure. */
export function isOAuthProvider(provider: string): boolean {
  return OAUTH_PROVIDERS.includes(provider);
}

/**
 * Plan 04-03 (Phase 4) — whether the OAuth auth-mode radio is `disabled`.
 * The radio is selectable ONLY when the selected provider has a pi-ai OAuth
 * subsystem AND the keychain is available (an OAuth login culminates in a
 * keychain write, so the Risk-4 read-only headless mode applies just as it
 * does to the API-key path). Pure — exported for the panel's tests.
 */
export function isOAuthRadioDisabled(data: ProviderAuthSnapshot | null, provider: string): boolean {
  return data?.keychain_available === false || !isOAuthProvider(provider);
}

/**
 * Plan 04-03 (Phase 4) — whether the "Login with OAuth" button is
 * `disabled`. Locked when the keychain is unavailable OR an OAuth flow is
 * already in progress (a flow that is not yet `complete`/`error`). Pure —
 * exported for the panel's tests.
 */
export function isOAuthLoginDisabled(
  data: ProviderAuthSnapshot | null,
  oauthFlow: OAuthFlowState | null,
): boolean {
  const flowInProgress =
    oauthFlow != null && oauthFlow.status !== 'complete' && oauthFlow.status !== 'error';
  return data?.keychain_available === false || flowInProgress;
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
  // alpha.36 fix: default to the SELECTED provider's actual mode (when
  // configured), not always 'api_key'. Pre-fix users who OAuth'd Anthropic
  // saw the API-key input form on every menu open even though their
  // credential was stored as oauth — same root cause as the "always asks
  // to authorize" complaint. Falls back to 'api_key' when the provider
  // isn't configured (initial empty state).
  const initialStatus = (): ProviderAuthStatus | undefined =>
    props.data?.statuses?.find((s) => s.provider === selectedProvider());
  const initialMode: PanelAuthMode =
    initialStatus()?.configured && initialStatus()?.mode === 'oauth' ? 'oauth' : 'api_key';
  const [selectedMode, setSelectedMode] = createSignal<PanelAuthMode>(initialMode);

  // alpha.36 fix: derive the per-provider configured-status indicator so the
  // panel can surface "✓ Already configured (oauth via Keychain)" instead of
  // rendering the auth-entry form as if it were the first time. Reactive on
  // selectedProvider so switching the dropdown updates the indicator.
  const currentProviderStatus = (): ProviderAuthStatus | null => {
    const provider = selectedProvider();
    return props.data?.statuses?.find((s) => s.provider === provider) ?? null;
  };
  const isCurrentProviderConfigured = (): boolean => {
    const status = currentProviderStatus();
    return status !== null && status.configured && status.mode !== null;
  };

  // alpha.41 fix: when the selected provider IS configured, hide the
  // auth-entry inputs (mode radios, API key field, OAuth login button)
  // behind a "Replace credentials" disclosure. Pre-fix the panel rendered
  // all those inputs prominently even when the user was already
  // authenticated — users opened the Provider menu expecting to switch
  // providers, saw a big "Login with OAuth" button + empty API key field,
  // and interpreted it as "SWT wants me to re-authenticate". The fix:
  // default to a collapsed state showing only the "✓ configured" banner +
  // a quiet "[Replace credentials]" link; the auth-entry form expands
  // only when the user explicitly opts in. First-time setup (provider
  // NOT configured) keeps the existing always-visible form.
  const [replacingCredentials, setReplacingCredentials] = createSignal<boolean>(false);
  // Whether the auth-entry inputs should be visible right now. The
  // ONE place that combines the two signals; everything below reads this.
  const showAuthEntryForm = (): boolean => {
    return !isCurrentProviderConfigured() || replacingCredentials();
  };

  // The ONLY place the entered API key lives. Bound to the password
  // <input>. Cleared on a successful save (write-only invariant).
  const [keyInput, setKeyInput] = createSignal<string>('');
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  // Plan 04-03 (Phase 4) — the ONLY place the manually-pasted OAuth
  // authorization code lives. Bound to the manual-code paste <input>;
  // cleared on a successful submit (write-only-input discipline, mirroring
  // the api_key `keyInput` clear). Holds the code only between typing and
  // `onSubmitOAuthCode` — never persisted.
  const [codeInput, setCodeInput] = createSignal<string>('');

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
    // alpha.41 — also collapse the "Replace credentials" disclosure on
    // success so the user immediately sees the updated "✓ configured"
    // banner without having to manually click Cancel. No-op when this
    // was a first-time setup (replacingCredentials was already false).
    setReplacingCredentials(false);
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
      <p class="tools-panel-meta">
        Chat mode uses the same credential as cook (cook/qa/init all share the resolved key).
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
            const next = e.currentTarget.value;
            setSelectedProvider(next);
            // alpha.41 — switching providers always returns the panel to
            // the collapsed "configured" state. Without this reset, a user
            // who clicked "Replace credentials" on provider A and then
            // switched the dropdown to provider B would land on B with
            // the replace form already open — confusing.
            setReplacingCredentials(false);
            setKeyInput('');
            setSaveError(null);
            // Plan 04-03 (Phase 4) — if the new provider has no pi-ai OAuth
            // subsystem, fall back to api_key mode so the panel never sits
            // in oauth mode for a provider that cannot do OAuth.
            if (selectedMode() === 'oauth' && !isOAuthProvider(next)) {
              setSelectedMode('api_key');
            }
            // alpha.36 fix: when switching to a configured provider, snap
            // the mode to the credential's stored mode so the form
            // reflects the actual auth state (instead of always defaulting
            // to api_key, which made it look like SWT "forgot" the OAuth
            // setup).
            const nextStatus = props.data?.statuses?.find((s) => s.provider === next);
            if (nextStatus?.configured && nextStatus.mode !== null) {
              setSelectedMode(nextStatus.mode);
            }
          }}
        >
          <For each={PROVIDER_VOCABULARY}>
            {(provider): JSX.Element => {
              const status = (): ProviderAuthStatus | undefined =>
                props.data?.statuses?.find((s) => s.provider === provider);
              const isConfigured = (): boolean =>
                status()?.configured === true && status()?.mode !== null;
              return (
                <option value={provider}>
                  {provider}
                  {isConfigured() ? ` ✓ ${status()?.mode}` : ''}
                </option>
              );
            }}
          </For>
        </select>
      </div>

      {/* alpha.36 + alpha.41 — surface the "already configured" state with a
          green banner. alpha.41 also hides the auth-entry form (radios + API
          key field + Login with OAuth button) behind a "Replace credentials"
          disclosure so users opening the menu to SWITCH providers don't see a
          prominent "Login with OAuth" / API-key input and interpret it as a
          re-auth requirement. The form expands only when the user explicitly
          clicks "Replace credentials". First-time setup (provider NOT
          configured) keeps the existing always-visible form. */}
      <Show when={isCurrentProviderConfigured()}>
        <p class="provider-auth-banner provider-auth-banner-ok tools-panel-banner">
          ✓ {selectedProvider()} is configured ({currentProviderStatus()?.mode} via{' '}
          {currentProviderStatus()?.label ?? currentProviderStatus()?.source ?? 'keychain'}). Pick a
          different provider from the dropdown above, or replace this credential below.
        </p>
        <Show when={!replacingCredentials()}>
          <div class="provider-auth-actions provider-auth-actions-replace">
            <button
              type="button"
              class="provider-auth-replace-btn"
              onClick={(): void => setReplacingCredentials(true)}
            >
              Replace credentials…
            </button>
          </div>
        </Show>
      </Show>

      <Show when={showAuthEntryForm()}>
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
            <label
              class="provider-auth-radio"
              classList={{
                'provider-auth-radio-disabled': isOAuthRadioDisabled(
                  props.data,
                  selectedProvider(),
                ),
              }}
            >
              <input
                type="radio"
                name="provider-auth-mode"
                value="oauth"
                checked={selectedMode() === 'oauth'}
                disabled={saving() || isOAuthRadioDisabled(props.data, selectedProvider())}
                onChange={(): void => {
                  setSelectedMode('oauth');
                }}
              />
              OAuth
              <Show when={!isOAuthProvider(selectedProvider())}>
                <span class="provider-auth-oauth-unavailable">
                  no OAuth subsystem for this provider
                </span>
              </Show>
            </label>
          </div>
          {/* alpha.22 — Anthropic OAuth billing-pool advisory. SWT/Pi sends
            the correct Claude Code identification headers, but Anthropic
            routes third-party OAuth requests to a separate `extra_usage`
            billing pool (empty by default) until Anthropic adds Pi's
            OAuth client_id to the Max-plan-routing allowlist. Until then,
            API key is the safer default for guaranteed quota routing. */}
          <Show when={selectedProvider() === 'anthropic' && selectedMode() === 'oauth'}>
            <p class="provider-auth-oauth-advisory">
              <strong>Note:</strong> Anthropic routes third-party OAuth requests to a separate
              billing pool that's empty by default. Until Anthropic adds SWT's OAuth client to their
              Max-plan allowlist (pending), <strong>API key</strong> is the recommended path for
              guaranteed quota routing. OAuth still works, but you may hit "out of extra usage"
              against your Max plan.
            </p>
          </Show>
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

        <Show when={selectedMode() === 'api_key'}>
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
        </Show>

        {/* Plan 04-03 (Phase 4) — the oauth-mode "Login with OAuth" button,
          shown IN PLACE OF the API-key input + Save button. Disabled when
          the keychain is unavailable or an OAuth flow is already running. */}
        <Show when={selectedMode() === 'oauth'}>
          <div class="provider-auth-actions">
            <button
              type="button"
              class="provider-auth-login-btn"
              disabled={
                props.onStartOAuth === undefined ||
                isOAuthLoginDisabled(props.data, props.oauthFlow ?? null)
              }
              onClick={(): void => void props.onStartOAuth?.(selectedProvider())}
            >
              Login with OAuth
            </button>
          </div>
        </Show>

        {/* alpha.41 — when in "replace credentials" mode, give the user a
          way to back out without saving. Hidden during first-time setup
          (provider NOT configured) since there's nothing to "cancel back
          to" — the form is the entry point. */}
        <Show when={isCurrentProviderConfigured() && replacingCredentials()}>
          <div class="provider-auth-actions provider-auth-actions-cancel">
            <button
              type="button"
              class="provider-auth-cancel-btn"
              disabled={saving()}
              onClick={(): void => {
                setReplacingCredentials(false);
                setKeyInput('');
                setSaveError(null);
              }}
            >
              Cancel (keep current credential)
            </button>
          </div>
        </Show>
      </Show>

      <Show when={saveError() ?? props.error}>
        {(message): JSX.Element => <p class="tools-panel-error">⚠ {message()}</p>}
      </Show>

      {/* Plan 04-03 (Phase 4) — the OAuth flow sub-section. Only rendered
          while an OAuth flow is active. Risk 4: the auth URL is shown
          ALWAYS once it arrives (not just headless), and the manual-code
          paste box appears on `awaiting_code`. The auth URL is rendered as
          a plain href/text node — no raw-HTML sink. Token-free by
          construction: the `oauthFlow` prop carries no secret. */}
      <Show when={props.oauthFlow} keyed>
        {(flow): JSX.Element => (
          <div class="provider-auth-oauth-section">
            <Switch>
              <Match when={flow.status === 'starting'}>
                <p class="provider-auth-oauth-status">Starting OAuth login…</p>
              </Match>
              <Match when={flow.status === 'awaiting_browser' || flow.status === 'awaiting_code'}>
                <p class="provider-auth-oauth-status">
                  Open this URL to authorize:{' '}
                  <a
                    class="provider-auth-oauth-url"
                    href={flow.authUrl ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {flow.authUrl}
                  </a>
                </p>
                <Show when={flow.instructions}>
                  <p class="provider-auth-oauth-status">{flow.instructions}</p>
                </Show>
                <Show when={flow.progressMessage}>
                  <p class="provider-auth-oauth-status">{flow.progressMessage}</p>
                </Show>
                <Show when={flow.status === 'awaiting_browser'}>
                  <p class="provider-auth-oauth-status">
                    The browser callback will complete automatically — or paste the code below if
                    prompted.
                  </p>
                </Show>
                <Show when={flow.status === 'awaiting_code'}>
                  <div class="provider-auth-oauth-code-box">
                    <input
                      type="text"
                      class="provider-auth-key-input"
                      autocomplete="off"
                      placeholder="paste the authorization code"
                      value={codeInput()}
                      onInput={(e): void => {
                        setCodeInput(e.currentTarget.value);
                      }}
                    />
                    <button
                      type="button"
                      class="provider-auth-save-btn"
                      onClick={(): void => {
                        void (async (): Promise<void> => {
                          const result = await props.onSubmitOAuthCode?.(codeInput().trim());
                          // Write-only-input discipline: clear the pasted
                          // code on a successful submit so it is not retained.
                          if (result && 'ok' in result) setCodeInput('');
                        })();
                      }}
                    >
                      Submit code
                    </button>
                  </div>
                </Show>
              </Match>
              <Match when={flow.status === 'complete'}>
                <p class="provider-auth-oauth-status">
                  ✓ OAuth login complete — {flow.provider} is now configured.
                </p>
                <button
                  type="button"
                  class="provider-auth-save-btn"
                  onClick={(): void => props.onDismissOAuthFlow?.()}
                >
                  Done
                </button>
              </Match>
              <Match when={flow.status === 'error'}>
                <p class="tools-panel-error">
                  ⚠ OAuth login failed
                  {flow.errorCode ? ` (${flow.errorCode})` : ''}: {flow.errorMessage}
                </p>
                <button
                  type="button"
                  class="provider-auth-save-btn"
                  onClick={(): void => props.onDismissOAuthFlow?.()}
                >
                  Dismiss
                </button>
              </Match>
            </Switch>
          </div>
        )}
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
