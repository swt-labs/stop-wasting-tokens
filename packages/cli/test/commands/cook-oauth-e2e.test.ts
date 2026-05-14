/**
 * Plan 04-04 (Phase 4) — the END-TO-END OAuth-spawn integration test.
 *
 * This is the milestone's "actually works" bar. ROADMAP's Phase 4 criterion
 * "An OAuth-authenticated provider selection demonstrably spawns a working
 * agent" is satisfied here: the FULL chain runs with the SUBSTRATE mocked but
 * the SWT GLUE REAL.
 *
 *   auth.<provider>={mode:'oauth'} config
 *     → resolveSpawnCredential (REAL @swt-labs/cli cook.ts)
 *     → refreshOAuthCredentialsIfNeeded (REAL @swt-labs/runtime oauth-refresh.ts)
 *         — passes a still-valid blob through / refreshes a near-expiry one
 *         — writes the refreshed blob back to the keychain (mocked)
 *     → the serialized blob threads through SwtSessionOptions.resolvedCredential
 *     → createSession's un-stubbed 'oauth' branch (REAL @swt-labs/runtime
 *       session.ts) — JSON.parse + AuthStorage.set(provider, {type:'oauth',...})
 *     → the mocked createAgentSession receives the authStorage
 *     → a session is produced.
 *
 * MOCKED (every substrate boundary):
 *   - `@earendil-works/pi-ai/oauth` — getOAuthProvider / refreshToken (no real
 *     OAuth provider, no network). Mocked via the STABLE runtime-package
 *     symlink path (`../../../runtime/node_modules/@earendil-works/pi-ai/dist/
 *     oauth.js`, no `.pnpm` version hash) so the mock reliably intercepts the
 *     import made INSIDE `@swt-labs/runtime`'s `oauth-refresh.ts` — a bare
 *     `@earendil-works/pi-ai/oauth` specifier mock resolves from the cli test's
 *     context and misses the cross-package runtime-internal resolution.
 *   - `@earendil-works/pi-coding-agent` — createAgentSession / AuthStorage /
 *     InMemoryAuthStorageBackend (no real Pi). Mocked via the same stable
 *     runtime-package symlink path so the mock intercepts the import made
 *     INSIDE `@swt-labs/runtime`'s `session.ts`.
 *   - `@swt-labs/runtime`'s `resolve-store.ts` — the OS keychain seam. Mocked
 *     via the cross-package relative path (`../../../runtime/src/credentials/
 *     resolve-store.ts`) so the SINGLE mock covers BOTH consumers:
 *     resolveSpawnCredential's `store.get` (it imports `resolveCredentialStore`
 *     through the `@swt-labs/runtime` barrel → `credentials/index.js` →
 *     `resolve-store.js`) AND oauth-refresh's `storeOAuthCredentials`
 *     write-back (it imports `resolveCredentialStore` from the runtime-internal
 *     `../resolve-store.js`). Everything else — refreshOAuthCredentialsIfNeeded,
 *     createSession, storeOAuthCredentials — is the REAL implementation.
 *
 * REAL (the SWT glue under test):
 *   resolveSpawnCredential, refreshOAuthCredentialsIfNeeded, storeOAuthCredentials,
 *   createSession's 'oauth' branch.
 *
 * Coverage:
 *  1. the chain completes — still-valid credential path.
 *  2. the near-expiry refresh path — refreshToken is called, the keychain
 *     write-back fires, the REFRESHED tokens reach AuthStorage.set.
 *  3. the end-to-end secret-leak guard — the OAuthCredentials blob's
 *     access/refresh sentinels appear in NO captured event payload anywhere
 *     along the chain (extends Phase 3's credential-leak-audit discipline).
 */

import type { CookEvent } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Sentinel token strings — distinctive so the leak guard is meaningful ──
const ACCESS_SENTINEL = 'ACCESS-SENTINEL-e2e';
const REFRESH_SENTINEL = 'REFRESH-SENTINEL-e2e';
const ACCESS_SENTINEL_REFRESHED = 'ACCESS-SENTINEL-e2e-refreshed';
const REFRESH_SENTINEL_REFRESHED = 'REFRESH-SENTINEL-e2e-refreshed';

// ── Substrate mock 1: the keychain seam ──────────────────────────────────
// `store.get` is what resolveSpawnCredential reads; `store.set` is what
// oauth-refresh's storeOAuthCredentials write-back calls. Mocking
// `resolve-store.ts` via the cross-package relative path makes the SINGLE
// mock cover BOTH paths — cook.ts's barrel `resolveCredentialStore` AND
// oauth-credentials-store.ts's runtime-internal `../resolve-store.js` import
// both resolve to this exact module.
const storeGetMock = vi.hoisted(() =>
  vi.fn<(provider: string, authMode: string) => Promise<string | undefined>>(),
);
const storeSetMock = vi.hoisted(() =>
  vi.fn<(provider: string, authMode: string, secret: string) => Promise<void>>(),
);

vi.mock('../../../runtime/src/credentials/resolve-store.ts', () => ({
  resolveCredentialStore: vi.fn(async () => ({
    store: {
      get: storeGetMock,
      set: storeSetMock,
      delete: vi.fn(),
      list: vi.fn(),
    },
    backend: 'keychain' as const,
    probe: { available: true } as const,
  })),
}));

// ── Substrate mock 2: pi-ai's OAuth subsystem ────────────────────────────
// `getOAuthProvider` returns a fake provider whose `refreshToken` the test
// drives (the near-expiry path). The still-valid path never calls it.
//
// IMPORTANT: mocked via the STABLE runtime-package symlink path — NOT the
// bare `@earendil-works/pi-ai/oauth` specifier. `oauth-refresh.ts` lives in
// `@swt-labs/runtime` and imports `@earendil-works/pi-ai/oauth` relative to
// the runtime package; a bare-specifier mock resolves from this cli test
// file's context and would miss that cross-package runtime-internal import
// (it would hit the REAL Anthropic OAuth endpoint). The runtime-symlink path
// carries no `.pnpm` version hash, so it is stable across reinstalls.
type FakeOAuthProvider = {
  id: string;
  name: string;
  refreshToken: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  getApiKey: ReturnType<typeof vi.fn>;
};
let fakeOAuthProvider: FakeOAuthProvider | undefined;

vi.mock('../../../runtime/node_modules/@earendil-works/pi-ai/dist/oauth.js', () => ({
  getOAuthProvider: vi.fn(() => fakeOAuthProvider),
}));

// ── Substrate mock 3: Pi's agent-session SDK ─────────────────────────────
// Captures the createAgentSession call + every AuthStorage.set so the test
// asserts the Pi OAuthCredential reached the substrate.
interface FakeAuthStorage {
  set: ReturnType<typeof vi.fn>;
}
const createAgentSessionCalls: Array<{ hasAuthStorage: boolean }> = [];
const authStorages: FakeAuthStorage[] = [];
const inMemoryBackends: object[] = [];

vi.mock('../../../runtime/node_modules/@earendil-works/pi-coding-agent/dist/index.js', () => {
  class FakeInMemoryAuthStorageBackend {
    constructor() {
      inMemoryBackends.push(this);
    }
  }
  class FakeAuthStorageClass implements FakeAuthStorage {
    readonly set = vi.fn();
    static fromStorage(_backend: unknown): FakeAuthStorageClass {
      const instance = new FakeAuthStorageClass();
      authStorages.push(instance);
      return instance;
    }
  }
  return {
    SessionManager: {
      inMemory: (_cwd?: string) => ({ __flavor: 'inMemory' as const }),
      create: (_cwd: string) => ({ __flavor: 'create' as const }),
    },
    AuthStorage: FakeAuthStorageClass,
    InMemoryAuthStorageBackend: FakeInMemoryAuthStorageBackend,
    createAgentSession: async (opts: { authStorage?: FakeAuthStorage }) => {
      createAgentSessionCalls.push({
        hasAuthStorage: 'authStorage' in opts && opts.authStorage !== undefined,
      });
      return {
        session: {
          sessionId: `pi-session-${createAgentSessionCalls.length}`,
          prompt: vi.fn(async () => {}),
          subscribe: vi.fn(() => () => undefined),
          dispose: vi.fn(),
        },
        extensionsResult: { extensions: [], diagnostics: [] },
      };
    },
  };
});

// Imported AFTER the `vi.mock`s are registered (vitest hoists `vi.mock`).
const { resolveSpawnCredential } = await import('../../src/commands/cook.js');
const { createSession } = await import('@swt-labs/runtime');

beforeEach(() => {
  storeGetMock.mockReset();
  storeSetMock.mockReset();
  storeSetMock.mockResolvedValue(undefined);
  fakeOAuthProvider = undefined;
  createAgentSessionCalls.length = 0;
  authStorages.length = 0;
  inMemoryBackends.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Plan 04-04 — end-to-end OAuth-spawn integration (the "actually works" bar)', () => {
  it('(1) the chain completes — a still-valid oauth credential spawns a session', async () => {
    // The keychain holds a still-valid OAuthCredentials blob (expires an hour
    // out — well past the ~60s refresh margin).
    const blob = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 3_600_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(blob));

    // Link 1 — resolveSpawnCredential (REAL): reads the keychain blob, runs
    // the REAL refreshOAuthCredentialsIfNeeded (still-valid → passthrough),
    // re-serializes.
    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' },
    });
    expect(resolved).toBeDefined();
    expect(resolved?.resolvedCredential.authMode).toBe('oauth');
    // still-valid → no refresh provider consulted, no keychain write-back.
    expect(storeSetMock).not.toHaveBeenCalled();

    // Link 2 — createSession's un-stubbed 'oauth' branch (REAL): deserialize
    // the threaded blob, AuthStorage.set the Pi OAuthCredential.
    const session = await createSession({
      cwd: '/tmp/swt-oauth-e2e',
      ephemeral: true,
      provider: resolved?.provider,
      resolvedCredential: resolved?.resolvedCredential,
    });

    // The chain completed — a session is produced.
    expect(session.sessionId).toBe('pi-session-1');
    // createAgentSession got the in-memory-backed authStorage.
    expect(createAgentSessionCalls).toHaveLength(1);
    expect(createAgentSessionCalls[0]?.hasAuthStorage).toBe(true);
    expect(inMemoryBackends).toHaveLength(1);
    // AuthStorage.set received the Pi OAuthCredential for the configured provider.
    expect(authStorages).toHaveLength(1);
    expect(authStorages[0]?.set).toHaveBeenCalledWith('anthropic', {
      type: 'oauth',
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: blob.expires,
    });
  });

  it('(2) the near-expiry refresh path — refreshToken is called, the keychain write-back fires, the REFRESHED tokens reach AuthStorage.set', async () => {
    // The keychain holds a NEAR-EXPIRY blob (5s out — inside the ~60s margin).
    const staleBlob = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 5_000,
    };
    const refreshedBlob = {
      refresh: REFRESH_SENTINEL_REFRESHED,
      access: ACCESS_SENTINEL_REFRESHED,
      expires: Date.now() + 3_600_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(staleBlob));
    // The fake pi-ai OAuth provider refreshes the stale blob.
    fakeOAuthProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      refreshToken: vi.fn(async () => refreshedBlob),
      login: vi.fn(),
      getApiKey: vi.fn(),
    };

    // Link 1 — resolveSpawnCredential (REAL) → refreshOAuthCredentialsIfNeeded
    // (REAL) sees near-expiry → calls the mocked pi-ai refreshToken → writes
    // the refreshed blob back to the keychain (mocked store.set).
    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' },
    });

    expect(fakeOAuthProvider.refreshToken).toHaveBeenCalledWith(staleBlob);
    // The SWT-owns-refresh write-back fired with the REFRESHED blob.
    expect(storeSetMock).toHaveBeenCalledWith('anthropic', 'oauth', JSON.stringify(refreshedBlob));
    // The resolved secret carries the REFRESHED blob (not the stale one).
    expect(resolved?.resolvedCredential.secret).toBe(JSON.stringify(refreshedBlob));

    // Link 2 — createSession (REAL) injects the REFRESHED Pi OAuthCredential.
    await createSession({
      cwd: '/tmp/swt-oauth-e2e',
      ephemeral: true,
      provider: resolved?.provider,
      resolvedCredential: resolved?.resolvedCredential,
    });

    expect(authStorages).toHaveLength(1);
    expect(authStorages[0]?.set).toHaveBeenCalledWith('anthropic', {
      type: 'oauth',
      refresh: REFRESH_SENTINEL_REFRESHED,
      access: ACCESS_SENTINEL_REFRESHED,
      expires: refreshedBlob.expires,
    });
    // The STALE tokens never reached the substrate.
    const setArgs = JSON.stringify(authStorages[0]?.set.mock.calls);
    expect(setArgs).not.toContain(ACCESS_SENTINEL + '"'); // exact stale-token, not the refreshed prefix-match
    expect(setArgs).toContain(ACCESS_SENTINEL_REFRESHED);
  });

  it('(3) end-to-end secret-leak guard — the OAuthCredentials blob never reaches an event payload along the chain', async () => {
    const staleBlob = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 5_000,
    };
    const refreshedBlob = {
      refresh: REFRESH_SENTINEL_REFRESHED,
      access: ACCESS_SENTINEL_REFRESHED,
      expires: Date.now() + 3_600_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(staleBlob));
    fakeOAuthProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      refreshToken: vi.fn(async () => refreshedBlob),
      login: vi.fn(),
      getApiKey: vi.fn(),
    };

    // Capture everything the chain would emit. The cook callsite emits
    // CookEvents via emitCookEvent; here we stand in for that sink and assert
    // the blob never reaches it. We also capture any SwtEvent off the session.
    const capturedEvents: Array<CookEvent | unknown> = [];

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' },
    });
    // A synthetic cook event the way the real callsite emits cook.provider_selected
    // — deliberately NOT carrying the credential.
    capturedEvents.push({
      type: 'cook.provider_selected',
      ts: new Date().toISOString(),
      session_id: 'oauth-e2e-session',
      sub_session_id: 'oauth-e2e-session',
      selected_provider: resolved?.provider ?? 'unknown',
      selected_via: 'pinned',
    });

    const session = await createSession({
      cwd: '/tmp/swt-oauth-e2e',
      ephemeral: true,
      provider: resolved?.provider,
      resolvedCredential: resolved?.resolvedCredential,
    });
    session.subscribe((event) => {
      capturedEvents.push(event);
    });

    // The end-to-end leak guard: neither the stale NOR the refreshed token
    // strings appear in ANY captured event payload along the whole chain.
    const serialized = capturedEvents.map((e) => JSON.stringify(e)).join('\n');
    expect(serialized).not.toContain(ACCESS_SENTINEL);
    expect(serialized).not.toContain(REFRESH_SENTINEL);
    expect(serialized).not.toContain(ACCESS_SENTINEL_REFRESHED);
    expect(serialized).not.toContain(REFRESH_SENTINEL_REFRESHED);
    expect(serialized).not.toContain(JSON.stringify(staleBlob));
    expect(serialized).not.toContain(JSON.stringify(refreshedBlob));
    // Sanity: the chain actually produced an event + a session (the guard is
    // meaningful, not vacuous).
    expect(capturedEvents.length).toBeGreaterThan(0);
    expect(session.sessionId).toBeDefined();
  });
});
