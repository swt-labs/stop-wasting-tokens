import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockSession, type SwtSession, MockSpawnerEnvironment } from '../src/index.js';
import type { createSession as CreateSessionFn } from '../src/session.js';

describe('@swt-labs/runtime — createMockSession (mock factory for tests)', () => {
  describe('createMockSession', () => {
    it('returns a SwtSession-shaped object with all required members', async () => {
      const session: SwtSession = await createMockSession({
        cwd: '/tmp/swt-runtime-test',
        ephemeral: true,
      });

      expect(typeof session.sessionId).toBe('string');
      expect(session.sessionId.length).toBeGreaterThan(0);
      expect(typeof session.prompt).toBe('function');
      expect(typeof session.subscribe).toBe('function');
      expect(typeof session.dispose).toBe('function');

      session.dispose();
    });

    it('subscribe returns an unsubscribe function that removes the listener', async () => {
      const session = await createMockSession({ cwd: '/tmp/swt-runtime-test', ephemeral: true });
      let received = 0;
      const unsubscribe = session.subscribe(() => {
        received += 1;
      });
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
      // Mock impl emits nothing, but the unsubscribe path must run cleanly.
      expect(received).toBe(0);
      session.dispose();
    });

    it('prompt throws if called after dispose', async () => {
      const session = await createMockSession({ cwd: '/tmp/swt-runtime-test', ephemeral: true });
      session.dispose();
      await expect(session.prompt('hi')).rejects.toThrow(/after dispose/);
    });
  });

  describe('MockSpawnerEnvironment', () => {
    it('probe reports available with name pi-runtime-mock', async () => {
      const env = new MockSpawnerEnvironment();
      const probe = await env.probe();
      expect(probe.available).toBe(true);
      expect(probe.name).toBe('pi-runtime-mock');
      expect(probe.version).toBeDefined();
    });

    it('getSpawner throws with a pointer to PR-03', async () => {
      const env = new MockSpawnerEnvironment();
      await expect(env.getSpawner()).rejects.toThrow(/PR-03|orchestration/);
    });
  });
});

/**
 * Phase 04 (G-04) — Pi-extension materialization assertion truth table.
 *
 * Covers the precondition guard inside `createSession`: when
 * `opts.extensionFactories` is non-empty but `materializeExtensionsToCustomTools`
 * yields zero customTools, the guard throws a `SWT: Pi extension registration
 * check failed` error before `createAgentSession` is ever invoked. Locked
 * Decision #6 ("No silent fallbacks") — see Phase 04 PLAN + .vbw-planning/CONTEXT.md.
 *
 * Uses the canonical `vi.doMock('@earendil-works/pi-coding-agent', ...)` +
 * dynamic-import harness pattern from `session-pi-bridge.test.ts:89-115`
 * (Scout §F + R02 mitigation). MUST NOT use a static top-of-file import of
 * `createSession` — that would defeat the mock and silently exercise the
 * real Pi SDK.
 *
 * Truth table:
 *   (a) extensionFactories === undefined        → no throw, Pi invoked
 *   (b) extensionFactories === []               → no throw, Pi invoked
 *   (c) extensionFactories with tool-registering factory → no throw, Pi invoked
 *   (d) extensionFactories with empty factory   → THROWS, Pi NOT invoked
 */
describe('createSession extensionFactories assertion (Phase 04 / G-04)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@earendil-works/pi-coding-agent');
  });

  // Install the canonical Pi mock + return a typed handle to the
  // dynamically-imported `createSession` plus a per-test invocation counter.
  // Mirrors `makeMockHarness` from session-pi-bridge.test.ts:64-118 — only
  // the bits `createSession` references at module-load + run time are mocked.
  async function loadCreateSessionWithMock(): Promise<{
    createSession: typeof CreateSessionFn;
    getInvocations: () => number;
  }> {
    let createAgentSessionInvocations = 0;

    // Reset modules BEFORE installing the doMock so the dynamic import below
    // re-evaluates `../src/session.js` against the freshly mocked Pi SDK.
    // The static `import { createMockSession, ... } from '../src/index.js'`
    // at the top of this file would otherwise have already cached the real
    // Pi module graph (via index.js re-exports of session.js), making
    // `vi.doMock` a no-op for the cached module.
    vi.resetModules();

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: {
        inMemory: (_cwd?: string) => ({ __flavor: 'inMemory' as const }),
        create: (_cwd: string) => ({ __flavor: 'create' as const }),
      },
      AuthStorage: {
        fromStorage: (_backend: unknown) => ({ set: vi.fn() }),
      },
      InMemoryAuthStorageBackend: class FakeInMemoryAuthStorageBackend {},
      DefaultResourceLoader: class FakeDefaultResourceLoader {
        async reload(): Promise<void> {}
        getSystemPrompt(): string | undefined {
          return undefined;
        }
        getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
          return { agentsFiles: [] };
        }
      },
      getAgentDir: () => '/tmp/swt-test-pi-agent-dir',
      createAgentSession: async (_opts: unknown) => {
        createAgentSessionInvocations += 1;
        return {
          session: {
            sessionId: `pi-session-${createAgentSessionInvocations}`,
            prompt: vi.fn(async (_text: string) => {}),
            subscribe: vi.fn(() => () => {}),
            dispose: vi.fn(),
          },
          extensionsResult: { extensions: [], diagnostics: [] },
        };
      },
    }));

    const { createSession } = await import('../src/session.js');
    return { createSession, getInvocations: () => createAgentSessionInvocations };
  }

  it('(a) does not throw when extensionFactories is undefined', async () => {
    const { createSession, getInvocations } = await loadCreateSessionWithMock();
    const session = await createSession({ cwd: '/tmp/swt-assert-test-a', ephemeral: true });
    expect(session).toBeDefined();
    // Guard short-circuits on `extensionFactories !== undefined` — Pi MUST
    // still be invoked exactly once (legitimate no-factories path).
    expect(getInvocations()).toBe(1);
  });

  it('(b) does not throw when extensionFactories is an empty array', async () => {
    const { createSession, getInvocations } = await loadCreateSessionWithMock();
    const session = await createSession({
      cwd: '/tmp/swt-assert-test-b',
      ephemeral: true,
      extensionFactories: [],
    });
    expect(session).toBeDefined();
    // Guard short-circuits on `extensionFactories.length > 0` — read-only
    // role spawns (Scout/QA) legitimately pass `[]` and MUST proceed.
    expect(getInvocations()).toBe(1);
  });

  it('(c) does not throw when extensionFactories register at least one tool', async () => {
    const { createSession, getInvocations } = await loadCreateSessionWithMock();
    // A factory that calls `pi.registerTool({...})` once — the happy path
    // shape used by every real SWT extension factory
    // (buildSwtAskUserExtension, buildResultProtocolExtension, etc.).
    // `pi: any` matches `SessionExtensionFactory = (pi: any) => void` so no
    // assignment-site cast is needed (see shared/types/session.ts:208).
    const validFactory = (pi: any): void => {
      pi.registerTool({
        name: 'swt_ask_user',
        description: 'test factory tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [] }),
      });
    };
    const session = await createSession({
      cwd: '/tmp/swt-assert-test-c',
      ephemeral: true,
      extensionFactories: [validFactory],
    });
    expect(session).toBeDefined();
    // Materialization produced 1 customTool → guard passes → Pi invoked.
    expect(getInvocations()).toBe(1);
  });

  it('(d) throws SWT precondition error when factories register zero tools', async () => {
    const { createSession, getInvocations } = await loadCreateSessionWithMock();
    // The Bug E condition: a factory was supplied but never called
    // `pi.registerTool(...)`. Materialization yields zero customTools.
    // `pi: any` matches `SessionExtensionFactory = (pi: any) => void` so no
    // assignment-site cast is needed (see shared/types/session.ts:208).
    const emptyFactory = (_pi: any): void => {
      /* intentionally registers nothing */
    };
    await expect(
      createSession({
        cwd: '/tmp/swt-assert-test-d',
        ephemeral: true,
        extensionFactories: [emptyFactory],
      }),
    ).rejects.toThrow(/SWT: Pi extension registration check failed/);
    // Critical assertion: Pi `createAgentSession` MUST NEVER be invoked when
    // the guard fires — proves the precondition short-circuits BEFORE any
    // Pi session is created.
    expect(getInvocations()).toBe(0);
  });
});
