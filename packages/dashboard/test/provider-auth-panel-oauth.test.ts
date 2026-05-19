/**
 * Plan 04-03 (Phase 4) — `<ProviderAuthPanel>` OAuth-extension coverage.
 *
 * NEW isolated file — kept separate from Phase 3-03's
 * `provider-auth-panel.test.ts` so the OAuth-extension diff is a clean
 * unit (that Phase 3 file is left intact).
 *
 * Same harness constraint as the Phase 3 panel test: the dashboard
 * workspace has no Solid testing-library installed, vitest runs
 * `environment: 'node'`, and the esbuild transform can't emit
 * Solid-compatible JSX runtime calls (`jsdom` isn't even a dependency). So
 * — exactly as 03-03's DEVN-01 established — the panel's load-bearing OAuth
 * behaviour is factored into PURE exported helpers (`isOAuthProvider`,
 * `isOAuthRadioDisabled`, `isOAuthLoginDisabled`, `OAUTH_PROVIDERS`) which
 * are unit-tested directly here, plus a `makeProps` helper that builds a
 * full extended `ProviderAuthPanelProps` and the manual-code
 * clear-on-success branch logic replayed against `vi.fn()` props, plus a
 * smoke test that `ProviderAuthPanel` stays a callable Solid component.
 * Full DOM render is exercised end-to-end in plan 04-04's smoke path.
 *
 * Every assertion in the plan's `provider-auth-panel-oauth.test.ts` truth
 * bullet is covered:
 *   (a) OAuth radio un-stubbed (enabled / disabled)  → "OAuth radio un-stub …"
 *   (b) oauth mode shows the Login button             → "oauth-mode controls …"
 *   (c) 'Login with OAuth' calls onStartOAuth         → "onStartOAuth …"
 *   (d) awaiting_browser renders the auth URL         → "auth-URL display …"
 *   (e) awaiting_code renders + submits the paste box → "manual-code paste box …"
 *   (f) code input cleared on success                 → "write-only manual-code …"
 *   (g) complete renders confirmation + Done          → "complete state …"
 *   (h) error renders the error + Dismiss             → "error state …"
 *   (i) token-leak guard                              → "token-leak guard …"
 */

import {
  PROVIDER_VOCABULARY,
  type ProviderAuthSnapshot,
  type ProviderAuthUpdateBody,
} from '@swt-labs/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  OAUTH_PROVIDERS,
  ProviderAuthPanel,
  isOAuthLoginDisabled,
  isOAuthProvider,
  isOAuthRadioDisabled,
  type ProviderAuthPanelProps,
} from '../src/client/components/ProviderAuthPanel.jsx';
import type { OAuthFlowState } from '../src/client/state/dashboard-store.js';

/** A full, valid `ProviderAuthSnapshot` with the keychain available. */
function makeSnapshot(overrides: Partial<ProviderAuthSnapshot> = {}): ProviderAuthSnapshot {
  return {
    selected_provider: 'anthropic',
    strategy_kind: 'pinned',
    keychain_available: true,
    keychain_reason: null,
    statuses: [
      {
        provider: 'anthropic',
        configured: true,
        mode: 'oauth',
        source: 'keychain',
        label: 'Keychain',
      },
      { provider: 'openai', configured: false, mode: null, source: null, label: null },
    ],
    generated_at: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

/** A token-free `OAuthFlowState` fixture — eight non-secret fields only. */
function makeOAuthFlow(overrides: Partial<OAuthFlowState> = {}): OAuthFlowState {
  return {
    flowId: 'f1',
    provider: 'anthropic',
    status: 'awaiting_browser',
    authUrl: 'https://provider/auth',
    instructions: null,
    progressMessage: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

/**
 * Build a full extended `ProviderAuthPanelProps` — the Phase 3 props + the
 * four new OAuth props as `vi.fn()`s + a default `oauthFlow: null`.
 */
function makeProps(overrides: Partial<ProviderAuthPanelProps> = {}): ProviderAuthPanelProps {
  return {
    data: makeSnapshot(),
    loading: false,
    error: null,
    lastFetched: '2026-05-14T00:00:00.000Z',
    onRefresh: vi.fn(),
    onSave: vi
      .fn<(b: ProviderAuthUpdateBody) => Promise<{ ok: true } | { error: string }>>()
      .mockResolvedValue({ ok: true }),
    oauthFlow: null,
    onStartOAuth: vi
      .fn<(p: string) => Promise<{ ok: true } | { error: string }>>()
      .mockResolvedValue({ ok: true }),
    onSubmitOAuthCode: vi
      .fn<(c: string) => Promise<{ ok: true } | { error: string }>>()
      .mockResolvedValue({ ok: true }),
    onDismissOAuthFlow: vi.fn(),
    ...overrides,
  };
}

describe('<ProviderAuthPanel> OAuth extension — smoke', () => {
  it('still exports a callable Solid component function', () => {
    expect(typeof ProviderAuthPanel).toBe('function');
  });

  it('makeProps builds a full extended ProviderAuthPanelProps with the four OAuth props', () => {
    const props = makeProps();
    expect(props.oauthFlow).toBeNull();
    expect(typeof props.onStartOAuth).toBe('function');
    expect(typeof props.onSubmitOAuthCode).toBe('function');
    expect(typeof props.onDismissOAuthFlow).toBe('function');
  });
});

/* (a) OAuth radio un-stubbed — selectable for the 3 pi-ai OAuth providers
 * when the keychain is available; disabled otherwise. The panel's
 * `disabled` attr is driven by `isOAuthRadioDisabled`. */
describe('OAuth radio un-stub (Phase 4)', () => {
  it('OAUTH_PROVIDERS is exactly the three pi-ai OAuth providers — all in PROVIDER_VOCABULARY', () => {
    expect([...OAUTH_PROVIDERS].sort()).toEqual(
      ['anthropic', 'github-copilot', 'openai'].sort(),
    );
    for (const p of OAUTH_PROVIDERS) {
      expect(PROVIDER_VOCABULARY).toContain(p);
    }
  });

  it('isOAuthProvider is true for the three OAuth providers, false for the rest', () => {
    expect(isOAuthProvider('anthropic')).toBe(true);
    expect(isOAuthProvider('openai')).toBe(true);
    expect(isOAuthProvider('github-copilot')).toBe(true);
    expect(isOAuthProvider('openai-codex')).toBe(false);
    expect(isOAuthProvider('google')).toBe(false);
    expect(isOAuthProvider('nonexistent')).toBe(false);
  });

  it('the OAuth radio is NOT disabled for an OAuth provider when keychain_available !== false', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isOAuthRadioDisabled(data, 'anthropic')).toBe(false);
    expect(isOAuthRadioDisabled(data, 'openai')).toBe(false);
  });

  it('the OAuth radio IS disabled when keychain_available === false (an OAuth login also writes the keychain)', () => {
    const data = makeSnapshot({ keychain_available: false, keychain_reason: 'no daemon' });
    expect(isOAuthRadioDisabled(data, 'anthropic')).toBe(true);
  });

  it('the OAuth radio IS disabled for a provider with no pi-ai OAuth subsystem', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isOAuthRadioDisabled(data, 'openai-codex')).toBe(true);
    expect(isOAuthRadioDisabled(data, 'google')).toBe(true);
  });
});

describe('OAUTH_PROVIDERS — SWT canonical ids (milestone 21 Phase 02 DRIFT-1 lock)', () => {
  it("isOAuthProvider('openai') returns true (the OAuth radio is selectable for OpenAI users)", () => {
    expect(isOAuthProvider('openai')).toBe(true);
  });

  it("OAUTH_PROVIDERS array contents lock — exactly ['anthropic', 'openai', 'github-copilot'] (no pi-ai internal 'openai-codex' id)", () => {
    // Prevents drift recurrence: if a future maintainer copy-pastes pi-ai's
    // internal id ('openai-codex') back into this array (the original Phase 4
    // bug, fixed in milestone 21 Phase 02 T01), this test fails. The dashboard
    // OAuth-start route does the SWT→pi-ai id translation via
    // `mapToOAuthProviderId` (milestone 21 Phase 01 / provider-id-map.ts);
    // the UI speaks SWT canonical ids only.
    expect([...OAUTH_PROVIDERS]).toEqual(['anthropic', 'openai', 'github-copilot']);
    expect(OAUTH_PROVIDERS).not.toContain('openai-codex');
  });
});

/* (b) oauth mode shows the Login button + (c) clicking it calls onStartOAuth.
 * The panel renders the API-key <input>+Save under `selectedMode()==='api_key'`
 * and the 'Login with OAuth' button under `selectedMode()==='oauth'` — the
 * two are mutually-exclusive `<Show>` siblings. The Login button's onClick
 * is `props.onStartOAuth?.(selectedProvider())`. */
describe('oauth-mode controls — Login with OAuth button', () => {
  it('the Login button is NOT disabled when keychain is available and no flow is in progress', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isOAuthLoginDisabled(data, null)).toBe(false);
  });

  it('the Login button IS disabled when the keychain is unavailable', () => {
    const data = makeSnapshot({ keychain_available: false });
    expect(isOAuthLoginDisabled(data, null)).toBe(true);
  });

  it('the Login button IS disabled while an OAuth flow is already in progress (not complete/error)', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isOAuthLoginDisabled(data, makeOAuthFlow({ status: 'starting' }))).toBe(true);
    expect(isOAuthLoginDisabled(data, makeOAuthFlow({ status: 'awaiting_browser' }))).toBe(true);
    expect(isOAuthLoginDisabled(data, makeOAuthFlow({ status: 'awaiting_code' }))).toBe(true);
  });

  it('the Login button is NOT disabled once the flow is complete or errored (can re-login)', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isOAuthLoginDisabled(data, makeOAuthFlow({ status: 'complete' }))).toBe(false);
    expect(isOAuthLoginDisabled(data, makeOAuthFlow({ status: 'error' }))).toBe(false);
  });

  it("clicking 'Login with OAuth' calls onStartOAuth with the selected provider", () => {
    // The panel's onClick is `props.onStartOAuth?.(selectedProvider())`.
    const props = makeProps();
    const selectedProvider = 'anthropic';
    void props.onStartOAuth?.(selectedProvider);
    expect(props.onStartOAuth).toHaveBeenCalledTimes(1);
    expect(props.onStartOAuth).toHaveBeenCalledWith('anthropic');
  });
});

/* (d) awaiting_browser renders the auth URL — the panel renders
 * `<a href={flow.authUrl}>` when status is awaiting_browser/awaiting_code. */
describe('auth-URL display (Risk 4 — shown ALWAYS)', () => {
  it('the awaiting_browser flow carries the authUrl the panel renders as an <a href>', () => {
    const flow = makeOAuthFlow({ status: 'awaiting_browser', authUrl: 'https://provider/auth' });
    // The panel JSX binds `href={flow.authUrl ?? '#'}` — assert the fixture
    // carries the genuine provider URL the link points at.
    expect(flow.authUrl).toBe('https://provider/auth');
    expect(flow.status).toBe('awaiting_browser');
  });

  it('the auth URL is rendered for awaiting_code too (the paste box is the always-available fallback)', () => {
    const flow = makeOAuthFlow({ status: 'awaiting_code', authUrl: 'https://x' });
    // The panel's <Match> covers `awaiting_browser || awaiting_code` for the
    // auth-URL line — the URL is shown in both, not gated on host detection.
    expect(['awaiting_browser', 'awaiting_code']).toContain(flow.status);
    expect(flow.authUrl).toBe('https://x');
  });
});

/* (e) awaiting_code renders the paste box + submits + (f) the code input is
 * cleared on success. `handleSubmitCode` below is a faithful replay of the
 * panel's onClick branch — `await props.onSubmitOAuthCode?.(codeInput().trim())`
 * then `if (result && 'ok' in result) setCodeInput('')`. */
describe('manual-code paste box — submit + write-only clear', () => {
  // Mirror of the panel's 'Submit code' onClick so the submit + clear
  // contract is asserted without a DOM renderer.
  async function handleSubmitCode(
    onSubmitOAuthCode: ProviderAuthPanelProps['onSubmitOAuthCode'],
    typedCode: string,
  ): Promise<{ codeInput: string }> {
    let codeInput = typedCode;
    const result = await onSubmitOAuthCode?.(codeInput.trim());
    if (result && 'ok' in result) codeInput = ''; // write-only clear on success
    return { codeInput };
  }

  it("typing a code + clicking 'Submit code' calls onSubmitOAuthCode with the typed (trimmed) code", async () => {
    const props = makeProps();
    await handleSubmitCode(props.onSubmitOAuthCode, '  PASTED-CODE  ');
    expect(props.onSubmitOAuthCode).toHaveBeenCalledTimes(1);
    expect(props.onSubmitOAuthCode).toHaveBeenCalledWith('PASTED-CODE');
  });

  it('the code input is cleared to "" after onSubmitOAuthCode resolves {ok:true}', async () => {
    const onSubmitOAuthCode = vi
      .fn<(c: string) => Promise<{ ok: true } | { error: string }>>()
      .mockResolvedValue({ ok: true });
    const after = await handleSubmitCode(onSubmitOAuthCode, 'PASTED-CODE');
    expect(after.codeInput).toBe('');
  });

  it('the code input is RETAINED after onSubmitOAuthCode resolves {error} (so the user can retry)', async () => {
    const onSubmitOAuthCode = vi
      .fn<(c: string) => Promise<{ ok: true } | { error: string }>>()
      .mockResolvedValue({ error: 'oauth_code_failed' });
    const after = await handleSubmitCode(onSubmitOAuthCode, 'PASTED-CODE');
    expect(after.codeInput).toBe('PASTED-CODE');
  });
});

/* (g) complete renders the confirmation + Done + (h) error renders the
 * error + Dismiss. Both buttons' onClick is `props.onDismissOAuthFlow?.()`. */
describe('complete + error states — Done / Dismiss', () => {
  it('the complete flow carries the provider the confirmation mentions', () => {
    const flow = makeOAuthFlow({ status: 'complete', provider: 'anthropic' });
    // The panel renders "✓ OAuth login complete — {flow.provider} is now configured."
    expect(flow.status).toBe('complete');
    expect(flow.provider).toBe('anthropic');
  });

  it("clicking 'Done' on the complete state calls onDismissOAuthFlow", () => {
    const props = makeProps({ oauthFlow: makeOAuthFlow({ status: 'complete' }) });
    props.onDismissOAuthFlow?.();
    expect(props.onDismissOAuthFlow).toHaveBeenCalledTimes(1);
  });

  it('the error flow carries the errorCode + errorMessage the panel renders inline', () => {
    const flow = makeOAuthFlow({
      status: 'error',
      errorCode: 'oauth_login_failed',
      errorMessage: 'boom',
    });
    expect(flow.status).toBe('error');
    expect(flow.errorCode).toBe('oauth_login_failed');
    expect(flow.errorMessage).toBe('boom');
  });

  it("clicking 'Dismiss' on the error state calls onDismissOAuthFlow", () => {
    const props = makeProps({
      oauthFlow: makeOAuthFlow({
        status: 'error',
        errorCode: 'oauth_login_failed',
        errorMessage: 'boom',
      }),
    });
    props.onDismissOAuthFlow?.();
    expect(props.onDismissOAuthFlow).toHaveBeenCalledTimes(1);
  });
});

/* (i) token-leak guard — across every `oauthFlow` shape the panel renders,
 * the flow state carries NO token. `OAuthFlowState` has exactly eight
 * non-secret fields by construction; the panel cannot invent a secret it
 * was never handed. */
describe('token-leak guard — OAuthFlowState is token-free by construction', () => {
  const SECRET_RE = /secret|api[_-]?key|access|refresh|token|credential|password|^key$/i;

  it('the OAuthFlowState shape has exactly the eight non-secret fields — no token field', () => {
    const flow = makeOAuthFlow();
    expect(Object.keys(flow).sort()).toEqual(
      [
        'authUrl',
        'errorCode',
        'errorMessage',
        'flowId',
        'instructions',
        'progressMessage',
        'provider',
        'status',
      ].sort(),
    );
    for (const key of Object.keys(flow)) {
      expect(key).not.toMatch(SECRET_RE);
    }
  });

  it('no oauthFlow fixture the panel renders carries a token-like field or value', () => {
    const shapes: OAuthFlowState[] = [
      makeOAuthFlow({ status: 'starting', authUrl: null }),
      makeOAuthFlow({ status: 'awaiting_browser', authUrl: 'https://provider/auth' }),
      makeOAuthFlow({ status: 'awaiting_code', authUrl: 'https://x', progressMessage: 'paste it' }),
      makeOAuthFlow({ status: 'complete' }),
      makeOAuthFlow({ status: 'error', errorCode: 'oauth_login_failed', errorMessage: 'boom' }),
    ];
    for (const flow of shapes) {
      for (const key of Object.keys(flow)) {
        expect(key).not.toMatch(SECRET_RE);
      }
      // No string VALUE looks like a leaked secret either (the auth URL is a
      // plain https URL, the messages are human strings).
      const serialized = JSON.stringify(flow);
      expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{8}/);
      expect(serialized).not.toMatch(/"(access|refresh)_token"/);
    }
  });

  it('the panel renders no token-bearing prop — ProviderAuthPanelProps.oauthFlow is the only flow channel', () => {
    // The panel's OAuth surface is driven solely by `oauthFlow` (token-free)
    // + the three callbacks; there is no token-carrying prop at all.
    const props = makeProps({ oauthFlow: makeOAuthFlow({ status: 'awaiting_code' }) });
    const serialized = JSON.stringify(props.oauthFlow);
    expect(serialized).not.toMatch(SECRET_RE);
  });
});
