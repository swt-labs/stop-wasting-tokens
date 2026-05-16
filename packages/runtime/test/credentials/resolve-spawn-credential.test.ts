/**
 * Plan 01-01 (Milestone 12) — unit suite for `resolveSpawnCredential` in its
 * new runtime-layer home. Covers the same branches the cli suite tested in
 * `cook-auth-wiring.test.ts` + `cook-oauth-refresh.test.ts`, but now with
 * the mocks targeting runtime-internal modules directly (the function lives
 * here, so the cleanest mock surface is the local `./resolve-store.js` +
 * `./oauth/oauth-refresh.js` modules it imports from).
 *
 * Cases (≥6 — eight here):
 *  1. api_key happy path → keychain HIT, return {provider, resolvedCredential}.
 *  2. oauth happy path → refresh passes blob through; serialized blob returned.
 *  3. oauth near-expiry refresh → refreshed blob is re-serialized into secret.
 *  4. No auth entry for provider → returns undefined (no throw, no keychain hit).
 *  5. Keychain miss (store.get → undefined) → returns undefined.
 *  6. Corrupt oauth blob (non-JSON) → returns undefined (refresh NEVER called).
 *  7. OAuthRefreshError → stderr breadcrumb emitted; degrades to stale blob
 *     (alpha.20 fix — NOT undefined).
 *  8. Unexpected error from resolveCredentialStore → returns undefined.
 *
 * Plus a structural barrel-export assertion so the contract is locked: if a
 * future refactor accidentally drops the re-export, this fails fast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as OAuthRefreshModule from '../../src/credentials/oauth/oauth-refresh.js';
import { resolveSpawnCredential } from '../../src/credentials/resolve-spawn-credential.js';

// `store.get` is the keychain seam; `refreshMock` is the SWT-owns-refresh
// seam. Both declared with `vi.hoisted` so they are initialised before the
// hoisted `vi.mock` factory closes over them.
const storeGetMock = vi.hoisted(() =>
  vi.fn<(provider: string, authMode: string) => Promise<string | undefined>>(),
);
const refreshMock = vi.hoisted(() =>
  vi.fn<
    (provider: string, credentials: Record<string, unknown>) => Promise<Record<string, unknown>>
  >(),
);

vi.mock('../../src/credentials/resolve-store.js', () => ({
  resolveCredentialStore: vi.fn(async () => ({
    store: {
      get: storeGetMock,
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    },
    backend: 'keychain' as const,
    probe: { available: true } as const,
  })),
}));

vi.mock('../../src/credentials/oauth/oauth-refresh.js', async (importActual) => {
  // Spread the real module so `OAuthRefreshError` (the class the suite drives
  // the `instanceof` degrade branch with) stays the genuine one — only
  // `refreshOAuthCredentialsIfNeeded` is swapped for a controllable vi.fn().
  const actual = await importActual<typeof OAuthRefreshModule>();
  return {
    ...actual,
    refreshOAuthCredentialsIfNeeded: refreshMock,
  };
});

// Sentinel token strings — distinctive so the leak guard is meaningful.
const ACCESS_SENTINEL = 'ACCESS-SENTINEL-runtime';
const REFRESH_SENTINEL = 'REFRESH-SENTINEL-runtime';

let stderrWrites: string[] = [];
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  storeGetMock.mockReset();
  refreshMock.mockReset();
  stderrWrites = [];
  stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      stderrWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('resolveSpawnCredential — api_key arm', () => {
  it('(1) api_key happy path → keychain HIT → resolves { provider, resolvedCredential }', async () => {
    storeGetMock.mockResolvedValue('sk-from-keychain');

    const resolved = await resolveSpawnCredential('openai', {
      openai: { mode: 'api_key' },
    });

    expect(resolved).toEqual({
      provider: 'openai',
      resolvedCredential: { authMode: 'api_key', secret: 'sk-from-keychain' },
    });
    expect(storeGetMock).toHaveBeenCalledWith('openai', 'api_key');
    // The refresh module is NEVER consulted on the api_key arm.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('(5) keychain miss (store.get → undefined) → returns undefined', async () => {
    storeGetMock.mockResolvedValue(undefined);

    const resolved = await resolveSpawnCredential('openai', {
      openai: { mode: 'api_key' },
    });

    expect(resolved).toBeUndefined();
    expect(storeGetMock).toHaveBeenCalledWith('openai', 'api_key');
  });

  it('(5b) empty-string secret → returns undefined (treated as a miss)', async () => {
    storeGetMock.mockResolvedValue('');

    const resolved = await resolveSpawnCredential('openai', {
      openai: { mode: 'api_key' },
    });

    expect(resolved).toBeUndefined();
  });
});

describe('resolveSpawnCredential — oauth arm', () => {
  it('(2) oauth happy path → refresh passes blob through; result re-serialized', async () => {
    const blob = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 3_600_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(blob));
    refreshMock.mockResolvedValue(blob);

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth' },
    });

    expect(refreshMock).toHaveBeenCalledWith('anthropic', blob);
    expect(resolved).toEqual({
      provider: 'anthropic',
      resolvedCredential: { authMode: 'oauth', secret: JSON.stringify(blob) },
    });
    expect(storeGetMock).toHaveBeenCalledWith('anthropic', 'oauth');
  });

  it('(3) oauth near-expiry → refreshed blob is re-serialized into the secret', async () => {
    const stale = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 5_000,
    };
    const refreshed = {
      refresh: `${REFRESH_SENTINEL}-2`,
      access: `${ACCESS_SENTINEL}-2`,
      expires: Date.now() + 3_600_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(stale));
    refreshMock.mockResolvedValue(refreshed);

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth' },
    });

    expect(resolved).toEqual({
      provider: 'anthropic',
      resolvedCredential: { authMode: 'oauth', secret: JSON.stringify(refreshed) },
    });
  });

  it('(6) corrupt oauth blob (non-JSON) → returns undefined (refresh NEVER called)', async () => {
    storeGetMock.mockResolvedValue('{ this is not valid json');

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth' },
    });

    expect(resolved).toBeUndefined();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('(7) OAuthRefreshError → stderr breadcrumb + degrade to stale blob (alpha.20 fix)', async () => {
    const { OAuthRefreshError } = await import('../../src/credentials/oauth/oauth-refresh.js');
    const stale = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 5_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(stale));
    refreshMock.mockRejectedValue(new OAuthRefreshError('refresh token revoked', 'anthropic'));

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth' },
    });

    // Degrade to the STALE token — NOT undefined.
    expect(resolved).toEqual({
      provider: 'anthropic',
      resolvedCredential: { authMode: 'oauth', secret: JSON.stringify(stale) },
    });
    // The breadcrumb was emitted with the byte-identical alpha.20 wording.
    const allStderr = stderrWrites.join('');
    expect(allStderr).toContain(
      'swt cook: provider anthropic — OAuth token refresh failed, using existing credential',
    );
    // Secret-leak guard — the blob's access/refresh sentinels appear in NO
    // breadcrumb.
    expect(allStderr).not.toContain(ACCESS_SENTINEL);
    expect(allStderr).not.toContain(REFRESH_SENTINEL);
    expect(allStderr).not.toContain(JSON.stringify(stale));
  });

  it('(7b) non-OAuthRefreshError thrown by refresh → returns undefined (degrades, no breadcrumb)', async () => {
    const stale = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 5_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(stale));
    refreshMock.mockRejectedValue(new Error('something unexpected'));

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth' },
    });

    expect(resolved).toBeUndefined();
  });
});

describe('resolveSpawnCredential — graceful-degrade branches', () => {
  it('(4) no auth entry for provider → returns undefined (keychain never consulted)', async () => {
    const resolved = await resolveSpawnCredential('openai', {});

    expect(resolved).toBeUndefined();
    expect(storeGetMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('(8) resolveCredentialStore throws unexpectedly → returns undefined', async () => {
    // store.get itself throwing is the simplest way to drive the outer
    // try/catch's belt-and-braces graceful-degrade branch. (The probe layer
    // itself never throws — but the catch is intentionally a wide net.)
    storeGetMock.mockRejectedValue(new Error('keychain exploded'));

    const resolved = await resolveSpawnCredential('openai', {
      openai: { mode: 'api_key' },
    });

    expect(resolved).toBeUndefined();
  });
});

describe('resolveSpawnCredential — barrel re-export contract (structural)', () => {
  it('is reachable from @swt-labs/runtime as a function (Plan 01-01 must_have)', async () => {
    const mod = await import('@swt-labs/runtime');
    expect(typeof mod.resolveSpawnCredential).toBe('function');
  });

  it('readProjectAuthConfig + parseAuthConfig + DEFAULT_AUTH_CONFIG are reachable too', async () => {
    const mod = await import('@swt-labs/runtime');
    expect(typeof mod.readProjectAuthConfig).toBe('function');
    expect(typeof mod.parseAuthConfig).toBe('function');
    expect(mod.DEFAULT_AUTH_CONFIG).toEqual({});
  });
});
