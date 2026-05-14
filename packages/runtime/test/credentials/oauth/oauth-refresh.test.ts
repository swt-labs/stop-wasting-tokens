/**
 * Plan 04-04 / Phase 4 (Risk 2) — unit tests for the SWT-owns-refresh module
 * (`refreshOAuthCredentialsIfNeeded`).
 *
 * Both substrate boundaries are mocked — NO real `pi-ai`, NO real keychain:
 *  - `@earendil-works/pi-ai/oauth` is `vi.mock`'d so `getOAuthProvider` is a
 *    controllable fake. Each test arms the module-level `currentProvider`
 *    switch with a fake `OAuthProviderInterface` whose `refreshToken` the
 *    test drives (or `undefined` for the unsupported-provider case).
 *  - `./oauth-credentials-store.js` is `vi.mock`'d so `storeOAuthCredentials`
 *    is a `vi.fn()` — the keychain write-back is observed, never performed.
 *
 * Coverage (per the plan's truth bullet):
 *  1. still-valid blob → returned unchanged; getOAuthProvider / refreshToken /
 *     storeOAuthCredentials NEVER called.
 *  2. near-expiry blob → getOAuthProvider + refreshToken + storeOAuthCredentials
 *     called; the fresh blob returned.
 *  3. already-expired blob → treated as near-expiry → refreshed.
 *  4. getOAuthProvider → undefined → input returned unchanged; no write-back.
 *  5. refreshToken rejecting → throws OAuthRefreshError; no write-back.
 *  6. blob with no `expires` / non-number `expires` → returned unchanged.
 *  7. secret-leak guard — no `console.*` call during a refresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';

/** A minimal fake `OAuthProviderInterface` — only `id` / `name` /
 *  `refreshToken` are exercised by the refresh module; the rest are stubbed
 *  to satisfy the type. */
type FakeProvider = {
  id: string;
  name: string;
  refreshToken: (c: OAuthCredentials) => Promise<OAuthCredentials>;
  login: () => Promise<OAuthCredentials>;
  getApiKey: (c: OAuthCredentials) => string;
};

// The module-level switch the `vi.mock` factory reads. `undefined` means
// `getOAuthProvider` returns `undefined` (the unsupported-provider case).
let currentProvider: FakeProvider | undefined;

vi.mock('@earendil-works/pi-ai/oauth', () => ({
  getOAuthProvider: vi.fn(() => currentProvider),
}));

// `storeOAuthCredentials` — the keychain write-back — is a `vi.fn()` so the
// suite observes the call without touching the real OS keychain.
const storeOAuthCredentialsMock = vi.hoisted(() =>
  vi.fn<(provider: string, creds: OAuthCredentials) => Promise<void>>(),
);
vi.mock('../../../src/credentials/oauth/oauth-credentials-store.js', () => ({
  storeOAuthCredentials: storeOAuthCredentialsMock,
}));

// Imported AFTER the `vi.mock`s are registered (vitest hoists `vi.mock`).
const { refreshOAuthCredentialsIfNeeded, OAuthRefreshError } = await import(
  '../../../src/credentials/oauth/oauth-refresh.js'
);
const { getOAuthProvider } = await import('@earendil-works/pi-ai/oauth');

beforeEach(() => {
  currentProvider = undefined;
  storeOAuthCredentialsMock.mockReset();
  storeOAuthCredentialsMock.mockResolvedValue(undefined);
  vi.mocked(getOAuthProvider).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a fake provider whose `refreshToken` returns / rejects on demand. */
function makeFakeProvider(
  refreshImpl: (c: OAuthCredentials) => Promise<OAuthCredentials>,
): FakeProvider {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    refreshToken: vi.fn(refreshImpl),
    login: vi.fn(async () => ({ refresh: 'r', access: 'a', expires: 0 })),
    getApiKey: vi.fn(() => 'api-key'),
  };
}

describe('Plan 04-04 — refreshOAuthCredentialsIfNeeded (SWT-owns-refresh)', () => {
  it('(1) still-valid blob → returned unchanged; pi-ai + keychain never touched', async () => {
    const creds: OAuthCredentials = {
      refresh: 'r',
      access: 'a',
      expires: Date.now() + 3_600_000, // an hour out — well past the margin
    };

    const result = await refreshOAuthCredentialsIfNeeded('anthropic', creds);

    expect(result).toBe(creds); // the SAME object — no refresh
    expect(getOAuthProvider).not.toHaveBeenCalled();
    expect(storeOAuthCredentialsMock).not.toHaveBeenCalled();
  });

  it('(2) near-expiry blob → refreshToken + keychain write-back; fresh blob returned', async () => {
    const oldCreds: OAuthCredentials = {
      refresh: 'r',
      access: 'a',
      expires: Date.now() + 5_000, // 5s out — inside the ~60s margin
    };
    const freshCreds: OAuthCredentials = {
      refresh: 'r2',
      access: 'a2',
      expires: Date.now() + 3_600_000,
    };
    currentProvider = makeFakeProvider(async () => freshCreds);

    const result = await refreshOAuthCredentialsIfNeeded('anthropic', oldCreds);

    expect(getOAuthProvider).toHaveBeenCalledWith('anthropic');
    expect(currentProvider.refreshToken).toHaveBeenCalledWith(oldCreds);
    expect(storeOAuthCredentialsMock).toHaveBeenCalledWith('anthropic', freshCreds);
    expect(result).toBe(freshCreds);
  });

  it('(3) already-expired blob → treated as near-expiry → refreshed', async () => {
    const expiredCreds: OAuthCredentials = {
      refresh: 'r',
      access: 'a',
      expires: Date.now() - 10_000, // already expired
    };
    const freshCreds: OAuthCredentials = {
      refresh: 'r2',
      access: 'a2',
      expires: Date.now() + 3_600_000,
    };
    currentProvider = makeFakeProvider(async () => freshCreds);

    const result = await refreshOAuthCredentialsIfNeeded('anthropic', expiredCreds);

    expect(currentProvider.refreshToken).toHaveBeenCalledWith(expiredCreds);
    expect(storeOAuthCredentialsMock).toHaveBeenCalledWith('anthropic', freshCreds);
    expect(result).toBe(freshCreds);
  });

  it('(4) getOAuthProvider → undefined → input returned unchanged; no write-back', async () => {
    const creds: OAuthCredentials = {
      refresh: 'r',
      access: 'a',
      expires: Date.now() + 5_000, // near-expiry — would refresh IF a provider existed
    };
    currentProvider = undefined; // no pi-ai OAuth provider for this id

    const result = await refreshOAuthCredentialsIfNeeded('unknown-provider', creds);

    expect(getOAuthProvider).toHaveBeenCalledWith('unknown-provider');
    expect(result).toBe(creds); // cannot refresh — degrade to the input
    expect(storeOAuthCredentialsMock).not.toHaveBeenCalled();
  });

  it('(5) refreshToken rejecting → throws OAuthRefreshError; no write-back', async () => {
    const creds: OAuthCredentials = {
      refresh: 'r',
      access: 'a',
      expires: Date.now() + 5_000,
    };
    currentProvider = makeFakeProvider(async () => {
      throw new Error('refresh token revoked');
    });

    await expect(
      refreshOAuthCredentialsIfNeeded('anthropic', creds),
    ).rejects.toBeInstanceOf(OAuthRefreshError);
    await expect(
      refreshOAuthCredentialsIfNeeded('anthropic', creds),
    ).rejects.toThrow(/refresh token revoked/);
    expect(storeOAuthCredentialsMock).not.toHaveBeenCalled();
  });

  it('(6) blob with no expires / non-number expires → returned unchanged', async () => {
    const noExpires = { refresh: 'r', access: 'a' } as unknown as OAuthCredentials;
    const badExpires = {
      refresh: 'r',
      access: 'a',
      expires: 'not-a-number',
    } as unknown as OAuthCredentials;

    const r1 = await refreshOAuthCredentialsIfNeeded('anthropic', noExpires);
    const r2 = await refreshOAuthCredentialsIfNeeded('anthropic', badExpires);

    expect(r1).toBe(noExpires);
    expect(r2).toBe(badExpires);
    expect(getOAuthProvider).not.toHaveBeenCalled();
    expect(storeOAuthCredentialsMock).not.toHaveBeenCalled();
  });

  it('(7) secret-leak guard — no console.* call during a refresh', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const oldCreds: OAuthCredentials = {
      refresh: 'REFRESH-SECRET',
      access: 'ACCESS-SECRET',
      expires: Date.now() + 5_000,
    };
    const freshCreds: OAuthCredentials = {
      refresh: 'REFRESH-SECRET-2',
      access: 'ACCESS-SECRET-2',
      expires: Date.now() + 3_600_000,
    };
    currentProvider = makeFakeProvider(async () => freshCreds);

    await refreshOAuthCredentialsIfNeeded('anthropic', oldCreds);

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('(margin override) a custom marginMs widens the refresh window', async () => {
    const creds: OAuthCredentials = {
      refresh: 'r',
      access: 'a',
      expires: Date.now() + 120_000, // 2min out — past the default 60s margin
    };
    const freshCreds: OAuthCredentials = {
      refresh: 'r2',
      access: 'a2',
      expires: Date.now() + 3_600_000,
    };
    currentProvider = makeFakeProvider(async () => freshCreds);

    // With a 5-minute margin the 2-minute-out credential IS near-expiry.
    const result = await refreshOAuthCredentialsIfNeeded('anthropic', creds, {
      marginMs: 300_000,
    });

    expect(currentProvider.refreshToken).toHaveBeenCalledWith(creds);
    expect(result).toBe(freshCreds);
  });
});
