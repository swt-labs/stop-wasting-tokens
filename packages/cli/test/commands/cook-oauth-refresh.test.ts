/**
 * Plan 04-04 (Phase 4 / Risk 2) — the cook-callsite OAuth refresh-on-expiry
 * unit suite.
 *
 * Kept ISOLATED from `cook-auth-wiring.test.ts` (Phase 2-04's API-key wiring
 * unit). The substrate is MOCKED end-to-end: `vi.mock('@swt-labs/runtime')`
 * spreads the real barrel and overrides `resolveCredentialStore` (a fake
 * `{ store, backend, probe }` whose `store.get` is a `vi.fn()` each test
 * controls) AND `refreshOAuthCredentialsIfNeeded` (a controllable `vi.fn()`).
 * `OAuthRefreshError` is the REAL class — the suite drives the cook callsite's
 * `instanceof OAuthRefreshError` degrade branch with a genuine instance. No
 * real keychain, no real `pi-ai`, no real network.
 *
 * Coverage (per the plan's truth bullet):
 *  1. still-valid blob → refreshOAuthCredentialsIfNeeded called with the parsed
 *     blob; resolvedCredential.secret is the serialized return value.
 *  2. refreshed blob (different access/expires) → the REFRESHED blob is
 *     re-serialized into resolvedCredential.secret (the refresh is threaded).
 *  3. corrupt non-JSON oauth blob → resolves undefined (graceful degrade).
 *  4. refreshOAuthCredentialsIfNeeded throwing OAuthRefreshError → caught,
 *     degrades to the ORIGINAL stale blob (not undefined, not a throw).
 *  5. 'api_key' path unchanged — refreshOAuthCredentialsIfNeeded NEVER called.
 *  6. secret-leak guard — the blob's access/refresh sentinels appear in NO
 *     stderr breadcrumb.
 */

import type * as RuntimeModule from '@swt-labs/runtime';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { resolveSpawnCredential } from '../../src/commands/cook.js';

// `store.get` is the keychain seam; `refreshMock` is the SWT-owns-refresh
// seam. Both declared with `vi.hoisted` so they are initialised before the
// hoisted `vi.mock` factory closes over them.
const storeGetMock = vi.hoisted(() =>
  vi.fn<(provider: string, authMode: string) => Promise<string | undefined>>(),
);
const refreshMock = vi.hoisted(() =>
  vi.fn<
    (
      provider: string,
      credentials: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>
  >(),
);

vi.mock('@swt-labs/runtime', async (importActual) => {
  const actual = await importActual<typeof RuntimeModule>();
  return {
    ...actual,
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
    // The SWT-owns-refresh module — mocked to a controllable vi.fn() so the
    // suite drives the passthrough / refreshed / throw paths. OAuthRefreshError
    // stays the REAL class (spread from `actual`) so the cook callsite's
    // `instanceof` check works against a genuine instance.
    refreshOAuthCredentialsIfNeeded: refreshMock,
  };
});

// Sentinel token strings — distinctive so the leak guard is meaningful.
const ACCESS_SENTINEL = 'ACCESS-SENTINEL-cook';
const REFRESH_SENTINEL = 'REFRESH-SENTINEL-cook';

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

describe('Plan 04-04 — resolveSpawnCredential oauth refresh-on-expiry', () => {
  it('(1) still-valid blob → refreshOAuthCredentialsIfNeeded called with the parsed blob; result re-serialized', async () => {
    const blob = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 3_600_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(blob));
    // refresh passes the still-valid blob through unchanged.
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

  it('(2) refreshed blob (different access/expires) → the REFRESHED blob is re-serialized into the secret', async () => {
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

    // The refresh RESULT is threaded — not the original stale blob.
    expect(resolved).toEqual({
      provider: 'anthropic',
      resolvedCredential: { authMode: 'oauth', secret: JSON.stringify(refreshed) },
    });
  });

  it('(3) corrupt non-JSON oauth blob → resolves undefined (graceful degrade, no throw)', async () => {
    storeGetMock.mockResolvedValue('{ this is not valid json');

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth' },
    });

    expect(resolved).toBeUndefined();
    // A corrupt blob is rejected BEFORE the refresh module is consulted.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('(4) refreshOAuthCredentialsIfNeeded throws OAuthRefreshError → degrades to the ORIGINAL stale blob', async () => {
    const { OAuthRefreshError } = await import('@swt-labs/runtime');
    const stale = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 5_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(stale));
    refreshMock.mockRejectedValue(
      new OAuthRefreshError('refresh token revoked', 'anthropic'),
    );

    const resolved = await resolveSpawnCredential('anthropic', {
      anthropic: { mode: 'oauth' },
    });

    // Degrade to the STALE token — not undefined, not a throw.
    expect(resolved).toEqual({
      provider: 'anthropic',
      resolvedCredential: { authMode: 'oauth', secret: JSON.stringify(stale) },
    });
  });

  it('(5) the api_key path is unchanged — refreshOAuthCredentialsIfNeeded is NEVER called', async () => {
    storeGetMock.mockResolvedValue('sk-xxx');

    const resolved = await resolveSpawnCredential('openai', {
      openai: { mode: 'api_key' },
    });

    expect(resolved).toEqual({
      provider: 'openai',
      resolvedCredential: { authMode: 'api_key', secret: 'sk-xxx' },
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('(6) secret-leak guard — the blob + its access/refresh sentinels appear in NO stderr breadcrumb', async () => {
    const { OAuthRefreshError } = await import('@swt-labs/runtime');
    const stale = {
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: Date.now() + 5_000,
    };
    storeGetMock.mockResolvedValue(JSON.stringify(stale));
    // Force the stderr-breadcrumb path (the only place resolveSpawnCredential
    // writes to stderr on the 'oauth' arm).
    refreshMock.mockRejectedValue(
      new OAuthRefreshError('network failure', 'anthropic'),
    );

    await resolveSpawnCredential('anthropic', { anthropic: { mode: 'oauth' } });

    // The breadcrumb WAS emitted (the degrade path ran) ...
    const allStderr = stderrWrites.join('');
    expect(allStderr).toContain('OAuth token refresh failed');
    expect(allStderr).toContain('anthropic');
    // ... but it carries only the provider id + a status string — never the
    // blob, never the access/refresh token values.
    expect(allStderr).not.toContain(ACCESS_SENTINEL);
    expect(allStderr).not.toContain(REFRESH_SENTINEL);
    expect(allStderr).not.toContain(JSON.stringify(stale));
  });
});
