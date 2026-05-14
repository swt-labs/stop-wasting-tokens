/**
 * Plan 04-02 / Phase 4 — unit tests for the keychain `OAuthCredentials`
 * storage helpers (`storeOAuthCredentials` / `readOAuthCredentials`).
 *
 * Tests must NEVER touch a real OS keychain. `oauth-credentials-store.ts`
 * imports exactly one symbol — `resolveCredentialStore` from
 * `../resolve-store.js` — so we `vi.doMock` that module with a fake
 * `{ store, backend, probe }` whose `store.set` / `store.get` are `vi.fn()`s
 * (mirrors `resolve-store.test.ts`'s `vi.doMock` + `vi.resetModules()` +
 * dynamic-import discipline).
 *
 * Coverage:
 *  1. storeOAuthCredentials JSON-stringifies the blob into
 *     store.set(provider, 'oauth', <JSON string>); the JSON round-trips.
 *  2. readOAuthCredentials parses the stored JSON back into the blob.
 *  3. readOAuthCredentials returns undefined when the keychain has no entry.
 *  4. readOAuthCredentials returns undefined (does NOT throw) on a corrupt
 *     non-JSON blob.
 *  5. both helpers pass 'oauth' (never 'api_key') as the authMode.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';

/** A controllable fake `CredentialStore` — `set` / `get` are `vi.fn()`s so
 *  the test asserts the exact `(provider, authMode, secret)` triple. */
function makeFakeStore() {
  const set = vi.fn(async (_provider: string, _mode: string, _secret: string) => {});
  const get = vi.fn(async (_provider: string, _mode: string) => undefined as string | undefined);
  return { set, get, delete: vi.fn(async () => false), list: vi.fn(async () => []) };
}

let fakeStore: ReturnType<typeof makeFakeStore>;

async function loadModule() {
  fakeStore = makeFakeStore();
  vi.doMock('../../../src/credentials/resolve-store.js', () => ({
    resolveCredentialStore: vi.fn(async () => ({
      store: fakeStore,
      backend: 'keychain' as const,
      probe: { available: true },
    })),
  }));
  vi.resetModules();
  return import('../../../src/credentials/oauth/oauth-credentials-store.js');
}

describe('@swt-labs/runtime — OAuth credentials keychain storage (Plan 04-02)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../../src/credentials/resolve-store.js');
    vi.restoreAllMocks();
  });

  it('storeOAuthCredentials JSON-stringifies the blob into store.set(provider, \'oauth\', ...)', async () => {
    const { storeOAuthCredentials } = await loadModule();
    const blob: OAuthCredentials = { refresh: 'r', access: 'a', expires: 123 };

    await storeOAuthCredentials('anthropic', blob);

    expect(fakeStore.set).toHaveBeenCalledTimes(1);
    const [provider, mode, stored] = fakeStore.set.mock.calls[0]!;
    expect(provider).toBe('anthropic');
    expect(mode).toBe('oauth');
    // The stored string is the JSON serialization — it round-trips back to
    // the original blob.
    expect(JSON.parse(stored as string)).toEqual(blob);
  });

  it('readOAuthCredentials parses the stored JSON string back into an OAuthCredentials object', async () => {
    const { readOAuthCredentials } = await loadModule();
    const blob: OAuthCredentials = { refresh: 'r2', access: 'a2', expires: 456 };
    fakeStore.get.mockResolvedValueOnce(JSON.stringify(blob));

    const got = await readOAuthCredentials('anthropic');

    expect(got).toEqual(blob);
    expect(fakeStore.get).toHaveBeenCalledWith('anthropic', 'oauth');
  });

  it('readOAuthCredentials returns undefined when the keychain has no entry', async () => {
    const { readOAuthCredentials } = await loadModule();
    fakeStore.get.mockResolvedValueOnce(undefined);

    expect(await readOAuthCredentials('anthropic')).toBeUndefined();
  });

  it('readOAuthCredentials returns undefined (does NOT throw) on a corrupt non-JSON blob', async () => {
    const { readOAuthCredentials } = await loadModule();
    fakeStore.get.mockResolvedValueOnce('{not json');

    await expect(readOAuthCredentials('anthropic')).resolves.toBeUndefined();
  });

  it("both helpers pass 'oauth' (never 'api_key') as the authMode", async () => {
    const { storeOAuthCredentials, readOAuthCredentials } = await loadModule();
    fakeStore.get.mockResolvedValueOnce(undefined);

    await storeOAuthCredentials('openai-codex', { refresh: 'r', access: 'a', expires: 1 });
    await readOAuthCredentials('openai-codex');

    expect(fakeStore.set.mock.calls[0]![1]).toBe('oauth');
    expect(fakeStore.get.mock.calls[0]![1]).toBe('oauth');
    // Negative assertion — never the api_key authMode.
    expect(fakeStore.set.mock.calls.some((c) => c[1] === 'api_key')).toBe(false);
    expect(fakeStore.get.mock.calls.some((c) => c[1] === 'api_key')).toBe(false);
  });
});
