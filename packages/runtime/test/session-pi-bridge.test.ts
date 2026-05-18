/**
 * Phase 03 remediation R01 — tests for the Pi `resourceLoader` bridge that
 * threads SWT's `SpawnAgentSessionConfig.systemPrompt + .contextFiles`
 * through `SwtSessionOptions` into Pi's
 * `CreateAgentSessionOptions.resourceLoader`.
 *
 * The bridge lives in `packages/runtime/src/session.ts:buildPiResourceLoader`
 * and is wired into both `createAgentSession` call sites (the Phase-2 auth
 * branch + the pre-Phase-2 fallthrough branch). Pi's
 * `AgentSession._rebuildSystemPrompt` reads `loader.getSystemPrompt()` →
 * `customPrompt` and `loader.getAgentsFiles().agentsFiles` → `contextFiles`
 * and feeds both into `buildSystemPrompt` at session-start — making the
 * role prompt + AGENTS.md content model-visible at turn 1.
 *
 * Closes GATE-07 + GATE-15 from 03-VERIFICATION.md.
 *
 * Uses the SAME `vi.doMock('@earendil-works/pi-coding-agent', ...)` harness
 * pattern Phase 2-02 / Phase 4 plan 04-04 established in
 * `session-oauth-injection.test.ts`. NO real Pi is touched — the mock
 * captures what `createAgentSession` receives + exposes a fake
 * `DefaultResourceLoader` that records its constructor options so tests
 * can assert the reshape.
 *
 * Coverage:
 *  (a) systemPrompt + contextFiles both provided → `resourceLoader` is
 *      passed; its `getSystemPrompt()` returns the systemPrompt verbatim;
 *      `getAgentsFiles().agentsFiles` returns the reshaped Pi `{path, content}`
 *      array with synthetic `AGENTS.md#<idx>` paths.
 *  (b) BOTH absent → `resourceLoader` is NOT passed (preserves pre-R01
 *      byte-identity — Pi falls back to its own `DefaultResourceLoader`).
 *  (c) systemPrompt alone → `resourceLoader` present with empty
 *      `getAgentsFiles().agentsFiles`.
 *  (d) contextFiles alone → `resourceLoader` present with `getSystemPrompt()`
 *      returning undefined.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

interface CapturedLoaderOptions {
  readonly cwd: string;
  readonly agentDir: string;
  readonly noContextFiles?: boolean;
  readonly systemPrompt?: string;
  readonly agentsFilesOverride?: () => { agentsFiles: Array<{ path: string; content: string }> };
}

interface FakeLoader {
  readonly options: CapturedLoaderOptions;
  reload: ReturnType<typeof vi.fn>;
  getSystemPrompt(): string | undefined;
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
}

interface CreateAgentSessionCall {
  readonly hasResourceLoader: boolean;
  readonly resourceLoader?: FakeLoader;
}

interface MockHarness {
  readonly createAgentSessionCalls: CreateAgentSessionCall[];
  readonly fakeLoaders: FakeLoader[];
}

function makeMockHarness(): MockHarness {
  const createAgentSessionCalls: CreateAgentSessionCall[] = [];
  const fakeLoaders: FakeLoader[] = [];

  class FakeDefaultResourceLoader implements FakeLoader {
    readonly options: CapturedLoaderOptions;
    readonly reload = vi.fn(async () => {});
    constructor(options: CapturedLoaderOptions) {
      this.options = options;
      fakeLoaders.push(this);
    }
    getSystemPrompt(): string | undefined {
      return this.options.systemPrompt;
    }
    getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
      // Mirror Pi's `DefaultResourceLoader` behaviour: when an override is
      // supplied, it replaces the base walk-up. Pi calls the override at
      // reload time; for test purposes calling it on access is equivalent.
      if (this.options.agentsFilesOverride !== undefined) {
        return this.options.agentsFilesOverride();
      }
      return { agentsFiles: [] };
    }
  }

  vi.doMock('@earendil-works/pi-coding-agent', () => ({
    SessionManager: {
      inMemory: (_cwd?: string) => ({ __flavor: 'inMemory' as const }),
      create: (_cwd: string) => ({ __flavor: 'create' as const }),
    },
    AuthStorage: {
      fromStorage: (_backend: unknown) => ({ set: vi.fn() }),
    },
    InMemoryAuthStorageBackend: class FakeInMemoryAuthStorageBackend {},
    DefaultResourceLoader: FakeDefaultResourceLoader,
    getAgentDir: () => '/tmp/swt-test-pi-agent-dir',
    createAgentSession: async (opts: { resourceLoader?: FakeLoader }) => {
      createAgentSessionCalls.push({
        hasResourceLoader: 'resourceLoader' in opts && opts.resourceLoader !== undefined,
        resourceLoader: opts.resourceLoader,
      });
      return {
        session: {
          sessionId: `pi-session-${createAgentSessionCalls.length}`,
          prompt: vi.fn(async (_text: string) => {}),
          subscribe: vi.fn(() => () => {}),
          dispose: vi.fn(),
        },
        extensionsResult: { extensions: [], diagnostics: [] },
      };
    },
  }));

  return { createAgentSessionCalls, fakeLoaders };
}

describe('createSession — Phase 03 R01 Pi resourceLoader bridge', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@earendil-works/pi-coding-agent');
  });

  it('(a) wires opts.systemPrompt + opts.contextFiles into a resourceLoader on createAgentSession', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({
      cwd: '/tmp/swt-r01',
      ephemeral: true,
      systemPrompt: 'TEST SYSTEM PROMPT BODY',
      contextFiles: ['fragment-A', 'fragment-B'],
    });

    expect(harness.createAgentSessionCalls).toHaveLength(1);
    const call = harness.createAgentSessionCalls[0]!;
    expect(call.hasResourceLoader).toBe(true);
    expect(call.resourceLoader).toBeDefined();
    expect(call.resourceLoader!.getSystemPrompt()).toBe('TEST SYSTEM PROMPT BODY');

    const agentsFiles = call.resourceLoader!.getAgentsFiles().agentsFiles;
    expect(agentsFiles).toHaveLength(2);
    expect(agentsFiles[0]!.content).toBe('fragment-A');
    expect(agentsFiles[1]!.content).toBe('fragment-B');
    expect(agentsFiles[0]!.path).toBe('AGENTS.md#0');
    expect(agentsFiles[1]!.path).toBe('AGENTS.md#1');

    // noContextFiles: true must be set so Pi does NOT re-discover AGENTS.md
    // from cwd (SWT's pack already loaded them — double-load guard).
    expect(harness.fakeLoaders).toHaveLength(1);
    expect(harness.fakeLoaders[0]!.options.noContextFiles).toBe(true);
    // reload() must be awaited before handing the loader to Pi (mirrors Pi
    // sdk.js — Pi defers reload to its own constructor path when no loader
    // is supplied, but takes the loader as-is when supplied).
    expect(harness.fakeLoaders[0]!.reload).toHaveBeenCalledTimes(1);
  });

  it('(b) omits resourceLoader when both systemPrompt and contextFiles are absent (pre-R01 byte-identity)', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({
      cwd: '/tmp/swt-r01',
      ephemeral: true,
    });

    expect(harness.createAgentSessionCalls).toHaveLength(1);
    expect(harness.createAgentSessionCalls[0]!.hasResourceLoader).toBe(false);
    expect(harness.createAgentSessionCalls[0]!.resourceLoader).toBeUndefined();
    // No DefaultResourceLoader was constructed — Pi will build its own
    // default loader inside createAgentSession (byte-identical to pre-R01).
    expect(harness.fakeLoaders).toHaveLength(0);
  });

  it('(c) wires systemPrompt alone — resourceLoader present, getAgentsFiles empty', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({
      cwd: '/tmp/swt-r01',
      ephemeral: true,
      systemPrompt: 'ROLE PROMPT ONLY',
    });

    expect(harness.createAgentSessionCalls).toHaveLength(1);
    const call = harness.createAgentSessionCalls[0]!;
    expect(call.hasResourceLoader).toBe(true);
    expect(call.resourceLoader!.getSystemPrompt()).toBe('ROLE PROMPT ONLY');
    expect(call.resourceLoader!.getAgentsFiles().agentsFiles).toHaveLength(0);
    expect(harness.fakeLoaders[0]!.options.noContextFiles).toBe(true);
  });

  it('(d) wires contextFiles alone — resourceLoader present, getSystemPrompt undefined', async () => {
    const harness = makeMockHarness();
    const { createSession } = await import('../src/session.js');

    await createSession({
      cwd: '/tmp/swt-r01',
      ephemeral: true,
      contextFiles: ['just-fragment'],
    });

    expect(harness.createAgentSessionCalls).toHaveLength(1);
    const call = harness.createAgentSessionCalls[0]!;
    expect(call.hasResourceLoader).toBe(true);
    expect(call.resourceLoader!.getSystemPrompt()).toBeUndefined();
    const agentsFiles = call.resourceLoader!.getAgentsFiles().agentsFiles;
    expect(agentsFiles).toHaveLength(1);
    expect(agentsFiles[0]!.content).toBe('just-fragment');
    expect(agentsFiles[0]!.path).toBe('AGENTS.md#0');
  });
});
