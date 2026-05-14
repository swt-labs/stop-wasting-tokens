/**
 * Plan 04-02 / Phase 4 — unit tests for the `pi-ai` OAuth subsystem driver
 * (`runOAuthLoginFlow`).
 *
 * `@earendil-works/pi-ai/oauth` is `vi.mock`'d so NO real OAuth flow, browser,
 * or network is touched in CI. The mock exposes a controllable fake
 * `getOAuthProvider` — each test arms it (via the module-level
 * `currentProvider` switch) with a fake `OAuthProviderInterface` whose
 * `login(callbacks)` the test drives: it calls `callbacks.onAuth(...)`,
 * `callbacks.onProgress(...)`, optionally `callbacks.onManualCodeInput()`,
 * then resolves a fake `OAuthCredentials` blob or rejects.
 *
 * Coverage:
 *  1. `login` calls `onAuth` then resolves → SWT's `onAuthUrl` + `onComplete`
 *     fire with the right args.
 *  2. `getOAuthProvider` → `undefined` → `onError('oauth_provider_unsupported')`,
 *     `login` never called.
 *  3. `login` rejects → `onError` fires with a non-empty code + message.
 *  4. `login` calls `onManualCodeInput()` → `onAwaitingCode` fires; the
 *     `submitManualCode` handle resolves the returned promise; the fed code
 *     reaches `login`'s continuation; `onComplete` fires afterward.
 *  5. secret-leak guard — after a successful flow the blob's access/refresh
 *     strings appear in NONE of the args to onAuthUrl/onProgress/
 *     onAwaitingCode/onError (only `onComplete` receives the blob).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
} from '@earendil-works/pi-ai/oauth';

/** A minimal fake `OAuthProviderInterface` — only `id` / `name` / `login` are
 *  exercised by the driver; the rest are stubbed to satisfy the type. */
type FakeProvider = {
  id: string;
  name: string;
  login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
  refreshToken: (c: OAuthCredentials) => Promise<OAuthCredentials>;
  getApiKey: (c: OAuthCredentials) => string;
};

// The module-level switch the `vi.mock` factory reads. `undefined` means
// `getOAuthProvider` returns `undefined` (the unsupported-provider case).
let currentProvider: FakeProvider | undefined;

vi.mock('@earendil-works/pi-ai/oauth', () => ({
  getOAuthProvider: vi.fn(() => currentProvider),
}));

// Imported AFTER `vi.mock` is registered (vitest hoists `vi.mock`).
const { runOAuthLoginFlow } = await import(
  '../../../src/credentials/oauth/oauth-flow.js'
);
const { getOAuthProvider } = await import('@earendil-works/pi-ai/oauth');

/** A flush helper — lets the driver's `void (async () => …)()` IIFE settle. */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

/** Build the set of SWT-side callbacks as `vi.fn()`s. */
function makeSwtCallbacks() {
  return {
    onAuthUrl: vi.fn(),
    onProgress: vi.fn(),
    onAwaitingCode: vi.fn(),
    onComplete: vi.fn(async () => {}),
    onError: vi.fn(),
  };
}

/** A fake provider whose `login` body the test supplies. */
function fakeProvider(
  login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>,
): FakeProvider {
  return {
    id: 'fake',
    name: 'Fake',
    login: vi.fn(login),
    refreshToken: vi.fn(async (c) => c),
    getApiKey: vi.fn(() => 'fake-key'),
  };
}

describe('@swt-labs/runtime — runOAuthLoginFlow (Plan 04-02)', () => {
  afterEach(() => {
    currentProvider = undefined;
    vi.clearAllMocks();
  });

  it('login calls onAuth then resolves → onAuthUrl + onComplete fire', async () => {
    const blob: OAuthCredentials = { refresh: 'r', access: 'a', expires: 1 };
    currentProvider = fakeProvider(async (callbacks) => {
      callbacks.onAuth({ url: 'https://x', instructions: 'go' });
      return blob;
    });
    const cb = makeSwtCallbacks();

    runOAuthLoginFlow({ provider: 'anthropic', flowId: 'flow-1', ...cb });
    await flush();

    expect(cb.onAuthUrl).toHaveBeenCalledWith('https://x', 'go');
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
    expect(cb.onComplete).toHaveBeenCalledWith(blob);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('getOAuthProvider returning undefined → onError(oauth_provider_unsupported), login never called', async () => {
    currentProvider = undefined; // getOAuthProvider returns undefined
    const cb = makeSwtCallbacks();

    const handle = runOAuthLoginFlow({
      provider: 'no-such-provider',
      flowId: 'flow-2',
      ...cb,
    });
    await flush();

    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError.mock.calls[0]![0]).toBe('oauth_provider_unsupported');
    expect(cb.onComplete).not.toHaveBeenCalled();
    // The handle's submitManualCode is a safe no-op when the flow never started.
    expect(() => handle.submitManualCode('x')).not.toThrow();
  });

  it('login rejecting → onError fires with a non-empty code + message containing the error', async () => {
    currentProvider = fakeProvider(async () => {
      throw new Error('boom');
    });
    const cb = makeSwtCallbacks();

    runOAuthLoginFlow({ provider: 'anthropic', flowId: 'flow-3', ...cb });
    await flush();

    expect(cb.onError).toHaveBeenCalledTimes(1);
    const [code, message] = cb.onError.mock.calls[0]!;
    expect(code).toBeTruthy();
    expect(message).toContain('boom');
    expect(cb.onComplete).not.toHaveBeenCalled();
  });

  it('login calls onManualCodeInput() → onAwaitingCode fires, submitManualCode feeds the code into login', async () => {
    const blob: OAuthCredentials = { refresh: 'r', access: 'a', expires: 1 };
    let codeSeenByLogin: string | undefined;
    currentProvider = fakeProvider(async (callbacks) => {
      // pi-ai's login awaits the manual-code promise, then continues.
      const code = await callbacks.onManualCodeInput!();
      codeSeenByLogin = code;
      return blob;
    });
    const cb = makeSwtCallbacks();

    const handle = runOAuthLoginFlow({
      provider: 'openai-codex',
      flowId: 'flow-4',
      ...cb,
    });
    await flush();

    // login is parked awaiting the manual code — onAwaitingCode fired,
    // onComplete has NOT yet.
    expect(cb.onAwaitingCode).toHaveBeenCalledTimes(1);
    expect(cb.onComplete).not.toHaveBeenCalled();

    // Feed the pasted code; login's continuation resolves the blob.
    handle.submitManualCode('CODE-123');
    await flush();

    expect(codeSeenByLogin).toBe('CODE-123');
    expect(cb.onComplete).toHaveBeenCalledWith(blob);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('secret-leak guard — the blob access/refresh strings never reach onAuthUrl/onProgress/onAwaitingCode/onError', async () => {
    const blob: OAuthCredentials = {
      refresh: 'REFRESH-SENTINEL-9f3a',
      access: 'ACCESS-SENTINEL-9f3a',
      expires: 1,
    };
    currentProvider = fakeProvider(async (callbacks) => {
      callbacks.onAuth({ url: 'https://x', instructions: 'go' });
      callbacks.onProgress?.('progressing');
      return blob;
    });
    const cb = makeSwtCallbacks();

    runOAuthLoginFlow({ provider: 'anthropic', flowId: 'flow-5', ...cb });
    await flush();

    // onComplete DID receive the blob — by design (the route persists it).
    expect(cb.onComplete).toHaveBeenCalledWith(blob);

    // But NO non-secret callback's arguments contain either sentinel token.
    const nonSecretArgs = [
      ...cb.onAuthUrl.mock.calls,
      ...cb.onProgress.mock.calls,
      ...cb.onAwaitingCode.mock.calls,
      ...cb.onError.mock.calls,
    ].flat();
    const serialized = JSON.stringify(nonSecretArgs);
    expect(serialized).not.toContain('ACCESS-SENTINEL-9f3a');
    expect(serialized).not.toContain('REFRESH-SENTINEL-9f3a');
  });

  it('getOAuthProvider is consulted with the requested provider id', async () => {
    currentProvider = fakeProvider(async () => ({
      refresh: 'r',
      access: 'a',
      expires: 1,
    }));
    runOAuthLoginFlow({ provider: 'github-copilot', flowId: 'f', ...makeSwtCallbacks() });
    await flush();
    expect(getOAuthProvider).toHaveBeenCalledWith('github-copilot');
  });
});
