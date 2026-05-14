/**
 * Plan 04-04 / Phase 4 — tests for the un-stubbed `createSession` `'oauth'`
 * credential-injection branch.
 *
 * Phase 2-02 left the `'oauth'` arm a clearly-commented stub that threw
 * `'createSession: oauth credential injection is not implemented until
 * Phase 4'`. Plan 04-04 replaces the throw with the real injection:
 * `JSON.parse` the serialized `OAuthCredentials` blob from
 * `resolvedCredential.secret`, build the Pi `{type:'oauth'} &
 * OAuthCredentials` `OAuthCredential`, and `authStorage.set(provider, ...)`
 * it on the SAME `InMemoryAuthStorageBackend`-backed `AuthStorage` the
 * `'api_key'` branch uses.
 *
 * Isolated from `session.real-pi.test.ts`. Extends the SAME
 * `vi.doMock('@earendil-works/pi-coding-agent', ...)` harness Phase 2-02
 * established — the mock exposes `createAgentSession` + `AuthStorage` +
 * `InMemoryAuthStorageBackend` fakes and captures what `createAgentSession`
 * + `AuthStorage.set` receive. NO real Pi.
 *
 * Coverage (per the plan's truth bullet):
 *  (a) a valid 'oauth' resolvedCredential → AuthStorage.set called with
 *      ('anthropic', {type:'oauth', ...OAuthCredentials}); createAgentSession
 *      got an authStorage arg.
 *  (b) a corrupt non-JSON 'oauth' secret → createSession rejects with a clear
 *      message (no silent mis-inject).
 *  (c) the Phase-4-fix assertion — a valid 'oauth' resolvedCredential NO
 *      LONGER throws /not implemented until Phase 4/.
 *  (d) secret-leak guard — the access/refresh sentinels never reach a mapped
 *      SwtEvent.
 *  (e) the 'api_key' branch + the no-resolvedCredential passthrough still
 *      behave as Phase 2-02 specified (the un-stub did not perturb them).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

interface MockAgentSession {
  readonly sessionId: string;
  prompt: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

/** A single `createAgentSession` invocation, with the keys the adapter passed. */
interface CreateAgentSessionCall {
  cwd?: string;
  sessionManagerFlavor: 'inMemory' | 'create';
  hasAuthStorage: boolean;
  authStorage?: FakeAuthStorage;
}

/** Fake Pi `AuthStorage` — captures `.set` calls so tests can assert args. */
interface FakeAuthStorage {
  set: ReturnType<typeof vi.fn>;
}

interface MockHarness {
  readonly createAgentSessionCalls: CreateAgentSessionCall[];
  readonly sessions: MockAgentSession[];
  readonly authStorages: FakeAuthStorage[];
  readonly inMemoryBackends: object[];
  emitPiEvent(event: unknown): void;
}

function makeMockHarness(): MockHarness {
  const createAgentSessionCalls: CreateAgentSessionCall[] = [];
  const sessions: MockAgentSession[] = [];
  const authStorages: FakeAuthStorage[] = [];
  const inMemoryBackends: object[] = [];
  let lastListener: ((event: unknown) => void) | undefined;

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

  vi.doMock('@earendil-works/pi-coding-agent', () => ({
    SessionManager: {
      inMemory: (_cwd?: string) => ({ __flavor: 'inMemory' as const }),
      create: (_cwd: string) => ({ __flavor: 'create' as const }),
    },
    AuthStorage: FakeAuthStorageClass,
    InMemoryAuthStorageBackend: FakeInMemoryAuthStorageBackend,
    createAgentSession: async (opts: {
      cwd?: string;
      sessionManager?: { __flavor: 'inMemory' | 'create' };
      authStorage?: FakeAuthStorage;
    }) => {
      createAgentSessionCalls.push({
        cwd: opts.cwd,
        sessionManagerFlavor: opts.sessionManager?.__flavor ?? 'create',
        hasAuthStorage: 'authStorage' in opts && opts.authStorage !== undefined,
        authStorage: opts.authStorage,
      });
      const session: MockAgentSession = {
        sessionId: `pi-session-${sessions.length + 1}`,
        prompt: vi.fn(async (_text: string) => {}),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          lastListener = listener;
          return () => {
            if (lastListener === listener) lastListener = undefined;
          };
        }),
        dispose: vi.fn(),
      };
      sessions.push(session);
      return { session, extensionsResult: { extensions: [], diagnostics: [] } };
    },
  }));

  return {
    createAgentSessionCalls,
    sessions,
    authStorages,
    inMemoryBackends,
    emitPiEvent(event: unknown): void {
      if (lastListener === undefined) {
        throw new Error('emitPiEvent: no listener registered yet');
      }
      lastListener(event);
    },
  };
}

// Sentinel token strings — distinctive so the leak guard is meaningful.
const ACCESS_SENTINEL = 'ACCESS-SENTINEL';
const REFRESH_SENTINEL = 'REFRESH-SENTINEL';
const OAUTH_EXPIRES = 9_999_999_999_999;

describe('createSession — un-stubbed oauth injection branch (Phase 4 / plan 04-04)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@earendil-works/pi-coding-agent');
  });

  it('(a) injects the Pi OAuthCredential — AuthStorage.set gets ({type:"oauth", ...creds})', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({
      cwd: '/tmp/swt-oauth',
      ephemeral: true,
      provider: 'anthropic',
      resolvedCredential: {
        authMode: 'oauth',
        secret: JSON.stringify({
          refresh: REFRESH_SENTINEL,
          access: ACCESS_SENTINEL,
          expires: OAUTH_EXPIRES,
        }),
      },
    });

    // createAgentSession got an authStorage arg, backed by an in-memory backend.
    expect(harness.createAgentSessionCalls).toHaveLength(1);
    expect(harness.createAgentSessionCalls[0]?.hasAuthStorage).toBe(true);
    expect(harness.createAgentSessionCalls[0]?.authStorage).toBeDefined();
    expect(harness.inMemoryBackends).toHaveLength(1);

    // AuthStorage.set was called with the Pi OAuthCredential shape.
    expect(harness.authStorages).toHaveLength(1);
    expect(harness.authStorages[0]?.set).toHaveBeenCalledTimes(1);
    expect(harness.authStorages[0]?.set).toHaveBeenCalledWith('anthropic', {
      type: 'oauth',
      refresh: REFRESH_SENTINEL,
      access: ACCESS_SENTINEL,
      expires: OAUTH_EXPIRES,
    });
  });

  it('(b) a corrupt non-JSON oauth secret → rejects with a clear message', async () => {
    makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await expect(
      createSession({
        cwd: '/tmp/swt-oauth',
        ephemeral: true,
        provider: 'anthropic',
        resolvedCredential: {
          authMode: 'oauth',
          secret: '{ this is not valid json',
        },
      }),
    ).rejects.toThrow(/not a valid OAuthCredentials JSON blob/);
  });

  it('(c) THE PHASE-4 FIX — a valid oauth resolvedCredential NO LONGER throws the Phase 2-02 stub', async () => {
    makeMockHarness();
    const { createSession } = await import('../src/session.js');

    // The Phase 2-02 stub threw /not implemented until Phase 4/. The branch is
    // un-stubbed — a valid blob must NOT throw that (or anything).
    await expect(
      createSession({
        cwd: '/tmp/swt-oauth',
        ephemeral: true,
        provider: 'anthropic',
        resolvedCredential: {
          authMode: 'oauth',
          secret: JSON.stringify({
            refresh: REFRESH_SENTINEL,
            access: ACCESS_SENTINEL,
            expires: OAUTH_EXPIRES,
          }),
        },
      }),
    ).resolves.toBeDefined();
  });

  it('(d) secret-leak guard — the access/refresh sentinels never reach a mapped SwtEvent', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    const session = await createSession({
      cwd: '/tmp/swt-oauth',
      ephemeral: true,
      provider: 'anthropic',
      resolvedCredential: {
        authMode: 'oauth',
        secret: JSON.stringify({
          refresh: REFRESH_SENTINEL,
          access: ACCESS_SENTINEL,
          expires: OAUTH_EXPIRES,
        }),
      },
    });

    const received: unknown[] = [];
    session.subscribe((event) => {
      received.push(event);
    });

    // Emit synthetic Pi events through the mock harness; capture the mapped
    // SwtEvents reaching the subscriber.
    harness.emitPiEvent({ type: 'agent_start' });
    harness.emitPiEvent({
      type: 'message_update',
      delta: { text: 'partial response' },
    });

    expect(received.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(received);
    expect(serialized).not.toContain(ACCESS_SENTINEL);
    expect(serialized).not.toContain(REFRESH_SENTINEL);
  });

  it('(e) the api_key branch is unperturbed — AuthStorage.set still gets ({type:"api_key", key})', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({
      cwd: '/tmp/swt-oauth',
      ephemeral: true,
      provider: 'openai',
      resolvedCredential: { authMode: 'api_key', secret: 'sk-test-xyz' },
    });

    expect(harness.authStorages).toHaveLength(1);
    expect(harness.authStorages[0]?.set).toHaveBeenCalledWith('openai', {
      type: 'api_key',
      key: 'sk-test-xyz',
    });
  });

  it('(e) the no-resolvedCredential passthrough is unperturbed — no authStorage, no backend', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({ cwd: '/tmp/swt-oauth', ephemeral: true });

    expect(harness.createAgentSessionCalls).toHaveLength(1);
    expect(harness.createAgentSessionCalls[0]?.hasAuthStorage).toBe(false);
    expect(harness.createAgentSessionCalls[0]?.authStorage).toBeUndefined();
    expect(harness.authStorages).toHaveLength(0);
    expect(harness.inMemoryBackends).toHaveLength(0);
  });
});
