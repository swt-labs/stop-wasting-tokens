/**
 * Plan 04-03 (Phase 4) — `dashboard-store` OAuth flow-state coverage.
 *
 * NEW isolated file — kept separate from Phase 3-04's
 * `dashboard-store.test.ts` so the OAuth-store diff is a clean unit (that
 * Phase 3 file is left intact).
 *
 * Mirrors the store-test harness `dashboard-store.test.ts` uses:
 * `vi.mock('../src/client/services/api.js', ...)` so the OAuth wrappers
 * (`postOAuthStart` / `postOAuthCode`) + `fetchProviderAuth` are
 * controllable `vi.fn()`s, and the store is driven through `createRoot` so
 * the Solid reactive scope is real.
 *
 * Covers the plan's `dashboard-store-oauth.test.ts` truth bullet:
 *   (a) startOAuthFlow sets `starting` + updates flowId from the response
 *   (b) startOAuthFlow failure → `error` + errors[]
 *   (c) oauth.auth_url → `awaiting_browser` + authUrl
 *   (d) oauth.awaiting_code → `awaiting_code`
 *   (e) oauth.complete → `complete` + providerAuth refetch
 *   (f) oauth.error → `error` + errorCode + errorMessage
 *   (g) non-matching flow_id is IGNORED (the flow_id correlator — Risk 4)
 *   (h) submitOAuthCode round-trip + the no-active-flow guard
 *   (i) dismissOAuthFlow clears the signal
 *   (j) token-leak guard — every event applied is token-free; the
 *       serialized oauthFlow never carries a token-like value
 */

import type { ProviderAuthSnapshot } from '@swt-labs/shared';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postOAuthStartMock = vi.fn();
const postOAuthCodeMock = vi.fn();
const fetchProviderAuthMock = vi.fn();
const openSseConnectionMock = vi.fn();

// Mirror dashboard-store.test.ts's mock mechanism — every api.ts export the
// store imports is a controllable vi.fn(). Only the OAuth-relevant ones are
// driven here; the rest are inert stubs so the module resolves.
vi.mock('../src/client/services/api.js', () => ({
  fetchSnapshot: vi.fn(),
  postInit: vi.fn(),
  postCommand: vi.fn(),
  postUatCheckpoint: vi.fn(),
  fetchArtifactRendered: vi.fn(),
  postCookStart: vi.fn(),
  postPromptRespond: vi.fn(),
  fetchConfig: vi.fn(),
  fetchDoctor: vi.fn(),
  fetchDetectPhase: vi.fn(),
  fetchUpdate: vi.fn(),
  fetchCommands: vi.fn(),
  postConfig: vi.fn(),
  postUpdateApply: vi.fn(),
  fetchProviderAuth: (...args: unknown[]) => fetchProviderAuthMock(...args),
  postProviderAuth: vi.fn(),
  postOAuthStart: (...args: unknown[]) => postOAuthStartMock(...args),
  postOAuthCode: (...args: unknown[]) => postOAuthCodeMock(...args),
  fetchUserNotes: vi.fn(),
  postUserNotes: vi.fn(),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

function makeProviderAuthSnapshot(
  overrides: Partial<ProviderAuthSnapshot> = {},
): ProviderAuthSnapshot {
  return {
    selected_provider: 'anthropic',
    strategy_kind: 'pinned',
    keychain_available: true,
    keychain_reason: null,
    statuses: [
      { provider: 'anthropic', configured: true, mode: 'oauth', source: 'keychain', label: 'Keychain' },
    ],
    generated_at: '2026-05-14T12:00:00.000Z',
    ...overrides,
  };
}

const ISO = '2026-05-14T12:00:00.000Z';

beforeEach(() => {
  postOAuthStartMock.mockReset();
  postOAuthCodeMock.mockReset();
  fetchProviderAuthMock.mockReset();
  openSseConnectionMock.mockReset();
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* (a) startOAuthFlow sets `starting` + updates flowId from the response */
describe('startOAuthFlow', () => {
  it('sets state.oauthFlow to a `starting` entry, calls postOAuthStart, and updates flowId on success', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({
        ok: true,
        flow_id: 'f1',
        provider: 'anthropic',
        started_at: ISO,
      });

      const promise = actions.startOAuthFlow('anthropic');
      // The provisional `starting` entry is set synchronously.
      expect(state.oauthFlow).not.toBeNull();
      expect(state.oauthFlow?.status).toBe('starting');
      expect(state.oauthFlow?.provider).toBe('anthropic');
      expect(state.oauthFlow?.flowId).toBe('');

      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(postOAuthStartMock).toHaveBeenCalledTimes(1);
      expect(postOAuthStartMock).toHaveBeenCalledWith('anthropic');
      // The real flow_id from the response is now on the signal.
      expect(state.oauthFlow?.flowId).toBe('f1');
      expect(state.oauthFlow?.status).toBe('starting');
      dispose();
    });
  });

  /* (b) startOAuthFlow failure → `error` + errors[] */
  it('on a postOAuthStart rejection sets status `error` and pushes to errors[]', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockRejectedValue(new Error('keychain_unavailable'));

      const result = await actions.startOAuthFlow('anthropic');
      expect(result).toEqual({ error: 'keychain_unavailable' });
      expect(state.oauthFlow?.status).toBe('error');
      expect(state.oauthFlow?.errorCode).toBe('oauth_start_failed');
      expect(state.oauthFlow?.errorMessage).toBe('keychain_unavailable');
      expect(state.errors.some((e) => e.message.includes('keychain_unavailable'))).toBe(true);
      dispose();
    });
  });
});

/* (c)-(f) the oauth.* applyEvent branches, flow_id-correlated */
describe('applyEvent — oauth.* branches', () => {
  it('oauth.auth_url advances a matching `starting` flow to `awaiting_browser` + sets authUrl', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await actions.startOAuthFlow('anthropic'); // flow active with flowId 'f1'

      actions.applyEvent({
        type: 'oauth.auth_url',
        ts: ISO,
        flow_id: 'f1',
        provider: 'anthropic',
        url: 'https://x',
      });
      expect(state.oauthFlow?.status).toBe('awaiting_browser');
      expect(state.oauthFlow?.authUrl).toBe('https://x');
      dispose();
    });
  });

  it('oauth.auth_url also matches a still-`starting` provisional flow (empty flowId, same provider)', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // Provisional entry: postOAuthStart still in flight, flowId is ''.
      let resolveStart: (v: unknown) => void = () => {};
      postOAuthStartMock.mockReturnValue(
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
      );
      const startPromise = actions.startOAuthFlow('anthropic');
      expect(state.oauthFlow?.flowId).toBe('');

      // An auth_url event arrives before the start response — correlated by
      // the still-`starting` + same-provider rule.
      actions.applyEvent({
        type: 'oauth.auth_url',
        ts: ISO,
        flow_id: 'f1',
        provider: 'anthropic',
        url: 'https://x',
      });
      expect(state.oauthFlow?.status).toBe('awaiting_browser');
      expect(state.oauthFlow?.flowId).toBe('f1');

      resolveStart({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await startPromise;
      dispose();
    });
  });

  it('oauth.progress updates progressMessage on a matching flow', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await actions.startOAuthFlow('anthropic');

      actions.applyEvent({
        type: 'oauth.progress',
        ts: ISO,
        flow_id: 'f1',
        provider: 'anthropic',
        message: 'exchanging code…',
      });
      expect(state.oauthFlow?.progressMessage).toBe('exchanging code…');
      // status was `starting` → advanced to `awaiting_browser`.
      expect(state.oauthFlow?.status).toBe('awaiting_browser');
      dispose();
    });
  });

  it('oauth.awaiting_code sets status `awaiting_code` on a matching flow', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await actions.startOAuthFlow('anthropic');

      actions.applyEvent({
        type: 'oauth.awaiting_code',
        ts: ISO,
        flow_id: 'f1',
        provider: 'anthropic',
        message: 'paste the code',
      });
      expect(state.oauthFlow?.status).toBe('awaiting_code');
      expect(state.oauthFlow?.progressMessage).toBe('paste the code');
      dispose();
    });
  });

  it('oauth.complete sets status `complete` AND triggers a providerAuth cell refetch', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      await actions.startOAuthFlow('anthropic');

      actions.applyEvent({
        type: 'oauth.complete',
        ts: ISO,
        flow_id: 'f1',
        provider: 'anthropic',
      });
      expect(state.oauthFlow?.status).toBe('complete');
      // The immediate `void refreshToolsCell('providerAuth')` — assert the
      // fetcher was called.
      await Promise.resolve();
      expect(fetchProviderAuthMock).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('oauth.error sets status `error` + errorCode + errorMessage on a matching flow', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await actions.startOAuthFlow('anthropic');

      actions.applyEvent({
        type: 'oauth.error',
        ts: ISO,
        flow_id: 'f1',
        provider: 'anthropic',
        code: 'oauth_login_failed',
        message: 'boom',
      });
      expect(state.oauthFlow?.status).toBe('error');
      expect(state.oauthFlow?.errorCode).toBe('oauth_login_failed');
      expect(state.oauthFlow?.errorMessage).toBe('boom');
      dispose();
    });
  });

  /* (g) non-matching flow_id is IGNORED — the flow_id correlator (Risk 4) */
  it('an oauth.* event with a NON-matching flow_id is ignored — state.oauthFlow is unchanged', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await actions.startOAuthFlow('anthropic');
      // Advance the flow to awaiting_browser so there is a concrete state to compare.
      actions.applyEvent({ type: 'oauth.auth_url', ts: ISO, flow_id: 'f1', provider: 'anthropic', url: 'https://x' });
      const before = JSON.stringify(state.oauthFlow);

      // An event for a DIFFERENT flow (another tab) must not cross-wire.
      actions.applyEvent({
        type: 'oauth.auth_url',
        ts: ISO,
        flow_id: 'other-flow',
        provider: 'github-copilot',
        url: 'https://y',
      });
      actions.applyEvent({
        type: 'oauth.error',
        ts: ISO,
        flow_id: 'other-flow',
        provider: 'github-copilot',
        code: 'x',
        message: 'y',
      });
      expect(JSON.stringify(state.oauthFlow)).toBe(before);
      dispose();
    });
  });

  it('oauth.* events are no-ops when there is no active flow at all', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      expect(state.oauthFlow).toBeNull();
      actions.applyEvent({ type: 'oauth.auth_url', ts: ISO, flow_id: 'f1', provider: 'anthropic', url: 'https://x' });
      actions.applyEvent({ type: 'oauth.complete', ts: ISO, flow_id: 'f1', provider: 'anthropic' });
      expect(state.oauthFlow).toBeNull();
      dispose();
    });
  });
});

/* (h) submitOAuthCode round-trip + the no-active-flow guard */
describe('submitOAuthCode', () => {
  it('with an active awaiting_code flow calls postOAuthCode(flowId, code) and returns {ok:true}', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      postOAuthCodeMock.mockResolvedValue({ ok: true, flow_id: 'f1' });
      await actions.startOAuthFlow('anthropic');
      actions.applyEvent({ type: 'oauth.awaiting_code', ts: ISO, flow_id: 'f1', provider: 'anthropic' });
      expect(state.oauthFlow?.status).toBe('awaiting_code');

      const result = await actions.submitOAuthCode('PASTED-CODE');
      expect(result).toEqual({ ok: true });
      expect(postOAuthCodeMock).toHaveBeenCalledTimes(1);
      expect(postOAuthCodeMock).toHaveBeenCalledWith('f1', 'PASTED-CODE');
      // The action does NOT optimistically complete — completion arrives via
      // the oauth.complete SSE event.
      expect(state.oauthFlow?.status).toBe('awaiting_code');
      dispose();
    });
  });

  it('returns {error:no_active_oauth_flow} and does NOT call postOAuthCode when there is no active flow', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      expect(state.oauthFlow).toBeNull();
      const result = await actions.submitOAuthCode('whatever');
      expect(result).toEqual({ error: 'no_active_oauth_flow' });
      expect(postOAuthCodeMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('returns {error:no_active_oauth_flow} when the flow has no flowId yet (still provisional)', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      // postOAuthStart never resolves → the flow stays provisional (flowId '').
      postOAuthStartMock.mockReturnValue(new Promise(() => {}));
      void actions.startOAuthFlow('anthropic');
      const result = await actions.submitOAuthCode('PASTED-CODE');
      expect(result).toEqual({ error: 'no_active_oauth_flow' });
      expect(postOAuthCodeMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('on a postOAuthCode rejection sets the flow errorMessage + pushes to errors[]', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      postOAuthCodeMock.mockRejectedValue(new Error('bad_code'));
      await actions.startOAuthFlow('anthropic');
      actions.applyEvent({ type: 'oauth.awaiting_code', ts: ISO, flow_id: 'f1', provider: 'anthropic' });

      const result = await actions.submitOAuthCode('WRONG');
      expect(result).toEqual({ error: 'bad_code' });
      expect(state.oauthFlow?.errorMessage).toBe('bad_code');
      expect(state.errors.some((e) => e.message.includes('bad_code'))).toBe(true);
      dispose();
    });
  });
});

/* (i) dismissOAuthFlow clears the signal */
describe('dismissOAuthFlow', () => {
  it('clears state.oauthFlow back to null', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await actions.startOAuthFlow('anthropic');
      expect(state.oauthFlow).not.toBeNull();

      actions.dismissOAuthFlow();
      expect(state.oauthFlow).toBeNull();
      dispose();
    });
  });
});

/* (j) token-leak guard — every oauth.* event applied is token-free; the
 * serialized oauthFlow never carries a token-like value. */
describe('token-leak guard — the oauthFlow signal is token-free', () => {
  const SECRET_RE = /secret|api[_-]?key|access|refresh|"token"|credential|password/i;

  it('after every oauth.* event, JSON.stringify(state.oauthFlow) carries no token-like value', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      await actions.startOAuthFlow('anthropic');

      // Every event in the lifecycle — none carries a token field by 04-01's
      // construction; the store reflects that.
      const events = [
        { type: 'oauth.auth_url', ts: ISO, flow_id: 'f1', provider: 'anthropic', url: 'https://x' },
        { type: 'oauth.progress', ts: ISO, flow_id: 'f1', provider: 'anthropic', message: 'working' },
        { type: 'oauth.awaiting_code', ts: ISO, flow_id: 'f1', provider: 'anthropic' },
        { type: 'oauth.error', ts: ISO, flow_id: 'f1', provider: 'anthropic', code: 'e', message: 'm' },
      ] as const;
      for (const evt of events) {
        actions.applyEvent(evt);
        const serialized = JSON.stringify(state.oauthFlow);
        expect(serialized).not.toMatch(SECRET_RE);
        expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{8}/);
      }
      dispose();
    });
  });

  it('the OAuthFlowState shape has exactly the eight non-secret fields — no token field', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      await actions.startOAuthFlow('anthropic');
      expect(Object.keys(state.oauthFlow ?? {}).sort()).toEqual(
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
      dispose();
    });
  });

  it('submitOAuthCode does NOT retain the pasted code anywhere on state.oauthFlow', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postOAuthStartMock.mockResolvedValue({ ok: true, flow_id: 'f1', provider: 'anthropic', started_at: ISO });
      postOAuthCodeMock.mockResolvedValue({ ok: true, flow_id: 'f1' });
      await actions.startOAuthFlow('anthropic');
      actions.applyEvent({ type: 'oauth.awaiting_code', ts: ISO, flow_id: 'f1', provider: 'anthropic' });

      await actions.submitOAuthCode('SENSITIVE-PASTED-CODE');
      // The code was passed straight to postOAuthCode — it must not appear
      // anywhere on the persisted flow state.
      expect(JSON.stringify(state.oauthFlow)).not.toContain('SENSITIVE-PASTED-CODE');
      dispose();
    });
  });
});
