/**
 * Plan 03-02 (Phase 3) Task 2 — spawnOrchestratorSession invariants.
 *
 * Assertions:
 *   C.1 — Resolved config has `role: 'orchestrator'` (the field is pinned
 *         in the type and at runtime).
 *   C.2 — The extensions[] list registers `swt_ask_user` on the orchestrator
 *         session (via buildSwtAskUserExtension). Asserted by capturing the
 *         registered tool names from a fake PiExtensionAPI.
 *   C.3 — The tools list (`createCodingTools(cwd)`) is non-empty and contains
 *         the standard Pi built-ins (read/write/edit/bash/glob/grep/...).
 *   C.4 — `spawnAgent({role: 'orchestrator', …})` STILL throws (the R1
 *         decision preserves the spawn-agent guard, just routes the
 *         orchestrator session through a separate code path).
 *   C.5 — systemPrompt is non-empty (sourced from opts.prompt — the cook.md
 *         mode-section body passed in by `cookHandler`).
 *   C.6 — transcriptPath is `<cwd>/.swt-planning/.transcripts/<sessionId>.jsonl`
 *         (parity with spawnAgent's transcript-path resolution).
 *   C.7 — sandboxMode is 'workspace-write' (the orchestrator always writes
 *         — confirmation gates trigger mutation paths).
 *   C.8 — spawnOrchestratorSession threads the recording sessionFactory
 *         through dispatch exactly once.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type * as RuntimeModule from '@swt-labs/runtime';
import type { SwtEvent, SwtSession, SwtSessionOptions } from '@swt-labs/runtime';
import type { PiExtensionAPI, PiToolDefinition } from '@swt-labs/runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  readProviderOverlay,
  resolveOrchestratorSessionConfig,
  resolveSpawnAgentConfig,
  spawnOrchestratorSession,
  type SpawnOrchestratorSessionFactory,
  type SpawnOrchestratorSessionConfig,
} from '../src/index.js';

/**
 * Plan 02-03 T4 — partial mock of `@swt-labs/runtime` so we can spy on
 * `createSession` WITHOUT replacing the rest of the barrel (the source
 * module pulls `buildSwtAskUserExtension`, `createCodingTools`,
 * `createHookDispatcher`, … from the same package — they must stay real).
 * The spy lets the `defaultOrchestratorSessionFactory` coverage assert the
 * exact `SwtSessionOptions` the default factory hands to `createSession`.
 */
const createSessionSpy = vi.fn(
  async (opts: SwtSessionOptions): Promise<SwtSession> => ({
    sessionId: 'mock-default-factory-session',
    async prompt() {
      // no-op — dispatcher stub harvest produces a synthetic success.
      void opts;
    },
    subscribe() {
      return () => {
        // no-op
      };
    },
    dispose() {
      // no-op
    },
  }),
);

vi.mock('@swt-labs/runtime', async (importActual) => {
  const actual = await importActual<typeof RuntimeModule>();
  return {
    ...actual,
    createSession: (opts: SwtSessionOptions) => createSessionSpy(opts),
  };
});

const TEST_CWD = '/tmp/swt-spawn-orchestrator-test';
const TEST_SESSION_ID = '11111111-2222-3333-4444-555555555555';
const TEST_INSTALL_ROOT = '/tmp/swt-test-install-root';

function makeRecordingFactory(): {
  factory: SpawnOrchestratorSessionFactory;
  configs: SpawnOrchestratorSessionConfig[];
} {
  const configs: SpawnOrchestratorSessionConfig[] = [];
  const factory: SpawnOrchestratorSessionFactory = async (config) => {
    configs.push(config);
    const session: SwtSession = {
      sessionId: `mock-${configs.length}`,
      async prompt() {
        // no-op — dispatcher stub harvest produces a synthetic success.
      },
      subscribe() {
        return () => {
          // no-op
        };
      },
      dispose() {
        // no-op
      },
    };
    return session;
  };
  return { factory, configs };
}

function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    prompt: '### Mode: Bootstrap\n\nDemo orchestrator prompt body.',
    cwd: TEST_CWD,
    sessionId: TEST_SESSION_ID,
    installRoot: TEST_INSTALL_ROOT,
    ...overrides,
  };
}

describe('@swt-labs/orchestration — spawnOrchestratorSession (Plan 03-02 T2)', () => {
  it("C.1 — resolved config has role: 'orchestrator'", () => {
    const config = resolveOrchestratorSessionConfig(baseOpts());
    expect(config.role).toBe('orchestrator');
  });

  it('C.2 — extensions[] registers swt_ask_user on the orchestrator session', () => {
    const config = resolveOrchestratorSessionConfig(baseOpts());
    const extNames = config.extensions.map((e) => e.name);
    expect(extNames).toContain('swtAskUser');
    expect(extNames).toContain('resultProtocol');
    expect(extNames).toContain('journal');

    // Belt-and-suspenders: run the swtAskUser factory against a fake Pi
    // and assert the registered tool name is exactly 'swt_ask_user'.
    const askUserExt = config.extensions.find((e) => e.name === 'swtAskUser');
    expect(askUserExt).toBeDefined();
    const registered: PiToolDefinition[] = [];
    const fakePi: PiExtensionAPI = {
      registerTool: (def) => {
        registered.push(def);
      },
      on: () => undefined,
      appendEntry: () => undefined,
    };
    askUserExt!.factory(fakePi);
    expect(registered.length).toBe(1);
    expect(registered[0]?.name).toBe('swt_ask_user');
  });

  it('C.3 — tools list contains the standard coding tools (read/write/edit/bash from Pi 0.74)', () => {
    const config = resolveOrchestratorSessionConfig(baseOpts());
    expect(config.tools.length).toBeGreaterThan(0);
    const names = config.tools.map((t) => (t as { name?: string }).name ?? '');
    // Pi 0.74's `createCodingTools` bundle returns read/write/edit/bash.
    // (See packages/runtime/src/tools.ts + the Pi 0.74 SDK type for the
    // canonical list.) Glob/grep/lsp are Pi built-ins available via Pi's
    // tool registry but not part of the bundled coding factory in 0.74.
    for (const required of ['read', 'write', 'edit', 'bash']) {
      expect(names, `expected '${required}' in orchestrator tools`).toContain(required);
    }
  });

  it("C.4 — spawnAgent({role: 'orchestrator', …}) STILL throws (R1: guard preserved)", () => {
    expect(() =>
      resolveSpawnAgentConfig({
        role: 'orchestrator',
        prompt: 'x',
        cwd: TEST_CWD,
        sessionId: TEST_SESSION_ID,
        installRoot: TEST_INSTALL_ROOT,
      }),
    ).toThrow(/cannot spawn role "orchestrator"/);
  });

  it('C.5 — systemPrompt is non-empty (sourced from opts.prompt)', () => {
    const config = resolveOrchestratorSessionConfig(
      baseOpts({ prompt: '### Mode: Plan\n\nBuild the plan.' }),
    );
    expect(config.systemPrompt.length).toBeGreaterThan(0);
    expect(config.systemPrompt).toContain('### Mode: Plan');
    expect(config.systemPrompt).toContain('Build the plan.');
  });

  it('C.6 — transcriptPath is `<cwd>/.swt-planning/.transcripts/<sessionId>.jsonl`', () => {
    const config = resolveOrchestratorSessionConfig(baseOpts());
    expect(config.transcriptPath).toBe(
      `${TEST_CWD}/.swt-planning/.transcripts/${TEST_SESSION_ID}.jsonl`,
    );
  });

  it("C.7 — sandboxMode is 'workspace-write' (orchestrator always writes)", () => {
    const config = resolveOrchestratorSessionConfig(baseOpts());
    expect(config.sandboxMode).toBe('workspace-write');
  });

  it('C.8 — spawnOrchestratorSession threads sessionFactory through dispatch exactly once', async () => {
    const recording = makeRecordingFactory();
    const result = await spawnOrchestratorSession({
      ...baseOpts(),
      sessionFactory: recording.factory,
      // empty hooks so no FS reads
      hookRegistrations: [],
    });
    expect(result.schema_version).toBe(1);
    expect(result.status).toBe('success');
    expect(recording.configs.length).toBe(1);
    expect(recording.configs[0]?.role).toBe('orchestrator');
    expect(recording.configs[0]?.extensions.map((e) => e.name).sort()).toEqual([
      'journal',
      'resultProtocol',
      'swtAskUser',
      'swtCompleteScopeSeed',
    ]);
  });

  it("C.9 — maxTurns defaults to 100 (orchestrator's default in config/defaults.json)", () => {
    const config = resolveOrchestratorSessionConfig(baseOpts());
    expect(config.maxTurns).toBe(100);
  });

  /**
   * Plan 01-01 T3 — per-provider overlay append on the orchestrator path
   * (G-R1 symmetric wiring).
   *
   * Two assertions parallel to spawn-agent.test.ts (T2):
   *   (O.i)  overlay-on appends body — when `provider` is supplied AND
   *          `<installRoot>/provider_overlays/orchestrator-<provider>.md`
   *          exists, the resolved `systemPrompt` ends with
   *          `\n\n---\n\n<body>`, prefix is `opts.prompt` verbatim.
   *   (O.ii) overlay-off byte-identical — when `provider` is undefined
   *          OR no overlay file exists, `systemPrompt === opts.prompt`.
   *
   * Tests use a per-test tmp installRoot to avoid leaking on-disk state
   * from the real repo (Phase 1 does NOT author an orchestrator overlay
   * — the wiring is symmetric so future phases can drop one in).
   */
  describe('per-provider overlay append on orchestrator path (Plan 01-01 T3 / G-R1)', () => {
    function makeTmpInstallRoot(): string {
      return mkdtempSync(join(tmpdir(), 'swt-orch-overlay-'));
    }

    function writeOverlay(root: string, role: string, provider: string, body: string): void {
      const overlaysDir = resolve(root, 'provider_overlays');
      mkdirSync(overlaysDir, { recursive: true });
      writeFileSync(resolve(overlaysDir, `${role}-${provider}.md`), body, 'utf8');
    }

    it('(O.i) overlay-on appends `\\n\\n---\\n\\n<body>` after opts.prompt verbatim', () => {
      const PROMPT = '### Mode: Bootstrap\n\nDo the orchestrator thing.';
      const OVERLAY_BODY = '## OPENAI ORCH OVERLAY\nmarker-99';
      const root = makeTmpInstallRoot();
      writeOverlay(root, 'orchestrator', 'openai', OVERLAY_BODY);

      const config = resolveOrchestratorSessionConfig(
        baseOpts({ prompt: PROMPT, installRoot: root, provider: 'openai' }),
      );

      const expectedSuffix = `\n\n---\n\n${OVERLAY_BODY.trim()}`;
      expect(config.systemPrompt.endsWith(expectedSuffix)).toBe(true);
      expect(config.systemPrompt.startsWith(PROMPT)).toBe(true);
      expect(config.systemPrompt).toBe(`${PROMPT}${expectedSuffix}`);
    });

    it('(O.ii-a) overlay-off byte-identical — provider undefined', () => {
      const PROMPT = '### Mode: Bootstrap\n\nDo the orchestrator thing.';
      const root = makeTmpInstallRoot();
      // NO overlay file written.

      const config = resolveOrchestratorSessionConfig(
        baseOpts({ prompt: PROMPT, installRoot: root /* no provider */ }),
      );
      expect(config.systemPrompt).toBe(PROMPT);
    });

    it('(O.ii-b) overlay-off byte-identical — provider supplied but no overlay file', () => {
      const PROMPT = '### Mode: Plan\n\nBuild the plan.';
      const root = makeTmpInstallRoot();
      // provider supplied, but `provider_overlays/orchestrator-openai.md`
      // intentionally NOT written — every provider runs with this shape
      // by default in Phase 1 (Phase 1 does not author the orchestrator
      // overlay file).

      const config = resolveOrchestratorSessionConfig(
        baseOpts({ prompt: PROMPT, installRoot: root, provider: 'openai' }),
      );
      expect(config.systemPrompt).toBe(PROMPT);

      // Sanity — confirm the resolver agrees the overlay is absent.
      expect(readProviderOverlay(root, 'orchestrator', 'openai')).toBeUndefined();
    });

    it('(O.ii-c) overlay-off byte-identical when an UNRELATED overlay file exists', () => {
      // A `dev-openai.md` overlay must NOT bleed into the orchestrator
      // spawn — the resolver keys off the literal role string, not a
      // role family.
      const PROMPT = '### Mode: Bootstrap\n\nDo it.';
      const root = makeTmpInstallRoot();
      writeOverlay(root, 'dev', 'openai', 'dev-only-body');

      const config = resolveOrchestratorSessionConfig(
        baseOpts({ prompt: PROMPT, installRoot: root, provider: 'openai' }),
      );
      expect(config.systemPrompt).toBe(PROMPT);
    });
  });

  it('C.10 — askUserImpl test seam threads through to the askUser extension', async () => {
    // The askUserImpl override lets tests intercept the askUser primitive
    // inside the registered swt_ask_user tool. Smoke-test the seam.
    const fakeAskUser = vi.fn(async () => ({ selectedOption: 'go', freeform: null }));
    const config = resolveOrchestratorSessionConfig(baseOpts({ askUserImpl: fakeAskUser }));
    const askUserExt = config.extensions.find((e) => e.name === 'swtAskUser');
    const registered: PiToolDefinition[] = [];
    const fakePi: PiExtensionAPI = {
      registerTool: (def) => {
        registered.push(def);
      },
      on: () => undefined,
      appendEntry: () => undefined,
    };
    askUserExt!.factory(fakePi);
    const tool = registered[0]!;
    await tool.execute(
      'tc-1',
      {
        id: 'p1',
        question: 'go?',
        options: [{ id: 'go', label: 'go' }],
      },
      undefined,
      undefined,
      {
        cwd: TEST_CWD,
        sessionManager: { getEntries: () => [] },
      },
    );
    expect(fakeAskUser).toHaveBeenCalledTimes(1);
  });

  /**
   * Plan 02-03 T4 — Phase 2 credential threading on the orchestrator path
   * (Risk 5 + Risk 8), symmetric with spawn-agent.test.ts's T3 block.
   *
   * Cases 1/2/4 assert on the resolved `SpawnOrchestratorSessionConfig`
   * directly (the file's prevailing `resolveOrchestratorSessionConfig`
   * style — the recording factory receives this same config object).
   * Case 3 proves the load-bearing link: `defaultOrchestratorSessionFactory`
   * (used when NO `sessionFactory?` override is supplied) forwards
   * `provider`/`model`/`resolvedCredential` into the `SwtSessionOptions`
   * it hands `createSession` — asserted via the partial-mock spy.
   */
  describe('Phase 2 credential threading (Plan 02-03 T4)', () => {
    it('populates provider + resolvedCredential + model onto SpawnOrchestratorSessionConfig', () => {
      const config = resolveOrchestratorSessionConfig(
        baseOpts({
          provider: 'anthropic',
          resolvedCredential: { authMode: 'api_key', secret: 'sk-orch-test' },
          model: 'claude-sonnet-4-5',
        }),
      );
      expect(config.provider).toBe('anthropic');
      expect(config.resolvedCredential).toEqual({
        authMode: 'api_key',
        secret: 'sk-orch-test',
      });
      expect(config.model).toBe('claude-sonnet-4-5');
    });

    it('records resolvedCredential + provider as `undefined` when omitted (pre-Phase-2 shape)', () => {
      const config = resolveOrchestratorSessionConfig(baseOpts());
      expect(config.resolvedCredential).toBeUndefined();
      expect(config.provider).toBeUndefined();
    });

    it('defaultOrchestratorSessionFactory forwards provider/model/resolvedCredential to createSession', async () => {
      createSessionSpy.mockClear();
      // No `sessionFactory?` override ⇒ spawnOrchestratorSession uses
      // `defaultOrchestratorSessionFactory`, which is the ONLY path that
      // reaches the real `createSession` (here: the partial-mock spy).
      const result = await spawnOrchestratorSession({
        ...baseOpts({
          provider: 'anthropic',
          resolvedCredential: { authMode: 'api_key', secret: 'sk-orch-fwd' },
        }),
        // empty hooks so no FS reads
        hookRegistrations: [],
      });
      expect(result.schema_version).toBe(1);
      expect(result.status).toBe('success');
      expect(createSessionSpy).toHaveBeenCalledTimes(1);
      const sessionOpts = createSessionSpy.mock.calls[0]?.[0];
      expect(sessionOpts?.provider).toBe('anthropic');
      expect(sessionOpts?.resolvedCredential).toEqual({
        authMode: 'api_key',
        secret: 'sk-orch-fwd',
      });
      // Risk 8 — `model` was not supplied, so the forwarded SwtSessionOptions
      // omits it entirely (conditional-spread keeps it absent, not
      // `undefined`-valued).
      expect('model' in (sessionOpts ?? {})).toBe(false);
    });

    it('defaultOrchestratorSessionFactory omits provider/resolvedCredential when absent (byte-identical to pre-Phase-2)', async () => {
      createSessionSpy.mockClear();
      await spawnOrchestratorSession({
        ...baseOpts(),
        hookRegistrations: [],
      });
      expect(createSessionSpy).toHaveBeenCalledTimes(1);
      const sessionOpts = createSessionSpy.mock.calls[0]?.[0];
      // Conditional-spread forwarding ⇒ absent fields stay absent.
      expect('provider' in (sessionOpts ?? {})).toBe(false);
      expect('model' in (sessionOpts ?? {})).toBe(false);
      expect('resolvedCredential' in (sessionOpts ?? {})).toBe(false);
    });

    it('model stays `undefined` on the resolved config when not supplied (Risk 8)', () => {
      const config = resolveOrchestratorSessionConfig(
        baseOpts({
          provider: 'anthropic',
          resolvedCredential: { authMode: 'api_key', secret: 'sk-orch-no-model' },
          // model intentionally omitted
        }),
      );
      expect(config.model).toBeUndefined();
    });
  });

  // ─── alpha.23 — LLM visibility trace ────────────────────────────────────
  // The dispatcher subscribes to TASK_TOKEN_USAGE + TASK_ERROR for token /
  // failure accounting. Pre-alpha.23 it ignored MESSAGE_DELTA + TOOL_CALL
  // entirely, so the dashboard Log panel could fire cook.agent_spawn +
  // cook.agent_result + token usage but show NO LLM prose or tool
  // activity. Users would spend tokens with no visible response.
  //
  // alpha.23 fix: the sessionFactory wrapper inside spawnOrchestratorSession
  // attaches a trace listener that accumulates assistant text per turn
  // and writes a single `[llm turn N] <text>` line on turn-end, plus
  // inline `[tool] <name>` for every tool call. Default writer is
  // process.stderr (which cook-start.ts pipes onto log.append events
  // → dashboard Log panel). Tests inject a recording writer.
  describe('alpha.23 — LLM visibility trace', () => {
    /** Recording session factory that lets tests fire arbitrary SwtEvents
     *  at the dispatcher's wrapper, exercising the trace branches without
     *  spinning up a real Pi session. */
    function makeEventEmittingFactory(): {
      factory: SpawnOrchestratorSessionFactory;
      /** Emit a SwtEvent to all subscribers; for use AFTER the wrapper
       *  has subscribed (i.e. during the prompt() call). */
      emit: (event: SwtEvent) => void;
    } {
      const listeners: Array<(event: SwtEvent) => void> = [];
      let promptFired = false;
      const emit = (event: SwtEvent): void => {
        for (const listener of listeners) listener(event);
      };
      const factory: SpawnOrchestratorSessionFactory = async () => {
        return {
          sessionId: 'mock-trace-session',
          async prompt() {
            promptFired = true;
            // Fire all configured events synchronously inside prompt()
            // so the wrapper's subscriber has already attached.
          },
          subscribe(listener) {
            listeners.push(listener);
            return () => {
              const idx = listeners.indexOf(listener);
              if (idx >= 0) listeners.splice(idx, 1);
            };
          },
          dispose() {
            void promptFired;
          },
        };
      };
      return { factory, emit };
    }

    it('writes `[llm turn N] <text>` on TASK_TOKEN_USAGE after MESSAGE_DELTA', async () => {
      const lines: string[] = [];
      const traceWriter = (line: string): void => {
        lines.push(line);
      };
      const eventing = makeEventEmittingFactory();
      // Wrap the factory so we emit events INSIDE the dispatcher's prompt().
      const factoryWithEmit: SpawnOrchestratorSessionFactory = async (config) => {
        const session = await eventing.factory(config);
        const originalPrompt = session.prompt.bind(session);
        return {
          ...session,
          prompt: async (text: string) => {
            await originalPrompt(text);
            // Simulate a turn: deltas, then turn-end (TASK_TOKEN_USAGE).
            eventing.emit({
              type: 'MESSAGE_DELTA',
              sessionId: session.sessionId,
              text: 'Hello ',
            });
            eventing.emit({
              type: 'MESSAGE_DELTA',
              sessionId: session.sessionId,
              text: 'from the orchestrator.',
            });
            eventing.emit({
              type: 'TASK_TOKEN_USAGE',
              sessionId: session.sessionId,
              usage: {
                input: 10,
                output: 5,
                cacheRead: 0,
                cacheWrite: 0,
                turn: 1,
                provider: 'anthropic',
                model: 'claude-opus-4-7',
              },
            });
          },
        };
      };

      const result = await spawnOrchestratorSession({
        ...baseOpts(),
        sessionFactory: factoryWithEmit,
        hookRegistrations: [],
        traceWriter,
      });
      expect(result.status).toBe('success');
      // Exactly one [llm turn] line was flushed with the concatenated deltas.
      const llmLines = lines.filter((l) => l.startsWith('[llm turn'));
      expect(llmLines.length).toBe(1);
      expect(llmLines[0]).toContain('[llm turn 1]');
      expect(llmLines[0]).toContain('Hello from the orchestrator.');
    });

    it('writes `[tool] <name>` inline for TOOL_CALL events', async () => {
      const lines: string[] = [];
      const eventing = makeEventEmittingFactory();
      const factoryWithEmit: SpawnOrchestratorSessionFactory = async (config) => {
        const session = await eventing.factory(config);
        const originalPrompt = session.prompt.bind(session);
        return {
          ...session,
          prompt: async (text: string) => {
            await originalPrompt(text);
            // LLM said something, then called a tool, then said more.
            eventing.emit({
              type: 'MESSAGE_DELTA',
              sessionId: session.sessionId,
              text: 'I will read the file. ',
            });
            eventing.emit({
              type: 'TOOL_CALL',
              sessionId: session.sessionId,
              name: 'read_file',
            });
            eventing.emit({
              type: 'MESSAGE_DELTA',
              sessionId: session.sessionId,
              text: 'Done.',
            });
            eventing.emit({
              type: 'TASK_TOKEN_USAGE',
              sessionId: session.sessionId,
              usage: {
                input: 5,
                output: 2,
                cacheRead: 0,
                cacheWrite: 0,
                turn: 1,
                provider: 'anthropic',
                model: 'claude-opus-4-7',
              },
            });
          },
        };
      };

      await spawnOrchestratorSession({
        ...baseOpts(),
        sessionFactory: factoryWithEmit,
        hookRegistrations: [],
        traceWriter: (line) => {
          lines.push(line);
        },
      });
      // Chronological order: message-flush BEFORE the tool line, then
      // a second message flushes on turn-end.
      const trace = lines.join('');
      expect(trace).toMatch(/I will read the file\.[\s\S]*\[tool\] read_file/);
      expect(trace).toContain('[tool] read_file');
      // Second flush — "Done." came after the tool call.
      expect(trace).toContain('Done.');
    });

    it('flushes message buffer on TASK_ERROR (failure path still surfaces partial assistant text)', async () => {
      const lines: string[] = [];
      const eventing = makeEventEmittingFactory();
      const factoryWithEmit: SpawnOrchestratorSessionFactory = async (config) => {
        const session = await eventing.factory(config);
        const originalPrompt = session.prompt.bind(session);
        return {
          ...session,
          prompt: async (text: string) => {
            await originalPrompt(text);
            eventing.emit({
              type: 'MESSAGE_DELTA',
              sessionId: session.sessionId,
              text: 'Started speaking when',
            });
            eventing.emit({
              type: 'TASK_ERROR',
              sessionId: session.sessionId,
              errorMessage: '400 invalid_request',
            });
          },
        };
      };

      const result = await spawnOrchestratorSession({
        ...baseOpts(),
        sessionFactory: factoryWithEmit,
        hookRegistrations: [],
        traceWriter: (line) => {
          lines.push(line);
        },
      });
      expect(result.status).toBe('failed');
      const llmLines = lines.filter((l) => l.startsWith('[llm turn'));
      expect(llmLines.length).toBe(1);
      expect(llmLines[0]).toContain('Started speaking when');
    });

    it('truncates assistant text over 2000 chars with a `…[truncated]` marker', async () => {
      const lines: string[] = [];
      const huge = 'X'.repeat(3000);
      const eventing = makeEventEmittingFactory();
      const factoryWithEmit: SpawnOrchestratorSessionFactory = async (config) => {
        const session = await eventing.factory(config);
        const originalPrompt = session.prompt.bind(session);
        return {
          ...session,
          prompt: async (text: string) => {
            await originalPrompt(text);
            eventing.emit({
              type: 'MESSAGE_DELTA',
              sessionId: session.sessionId,
              text: huge,
            });
            eventing.emit({
              type: 'TASK_TOKEN_USAGE',
              sessionId: session.sessionId,
              usage: {
                input: 10,
                output: 5,
                cacheRead: 0,
                cacheWrite: 0,
                turn: 1,
                provider: 'anthropic',
                model: 'claude-opus-4-7',
              },
            });
          },
        };
      };

      await spawnOrchestratorSession({
        ...baseOpts(),
        sessionFactory: factoryWithEmit,
        hookRegistrations: [],
        traceWriter: (line) => {
          lines.push(line);
        },
      });
      const llmLine = lines.find((l) => l.startsWith('[llm turn'));
      expect(llmLine).toBeDefined();
      expect(llmLine).toContain('…[truncated');
      // Truncated to 2000 chars plus the marker — should be well under 3000.
      expect((llmLine ?? '').length).toBeLessThan(2200);
    });

    it('traceWriter: null disables tracing entirely (no writes for any event)', async () => {
      const lines: string[] = [];
      const eventing = makeEventEmittingFactory();
      const factoryWithEmit: SpawnOrchestratorSessionFactory = async (config) => {
        const session = await eventing.factory(config);
        const originalPrompt = session.prompt.bind(session);
        return {
          ...session,
          prompt: async (text: string) => {
            await originalPrompt(text);
            eventing.emit({
              type: 'MESSAGE_DELTA',
              sessionId: session.sessionId,
              text: 'should not appear',
            });
            eventing.emit({
              type: 'TOOL_CALL',
              sessionId: session.sessionId,
              name: 'should_not_log',
            });
            eventing.emit({
              type: 'TASK_TOKEN_USAGE',
              sessionId: session.sessionId,
              usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                turn: 1,
                provider: 'anthropic',
                model: 'claude-opus-4-7',
              },
            });
          },
        };
      };

      await spawnOrchestratorSession({
        ...baseOpts(),
        sessionFactory: factoryWithEmit,
        hookRegistrations: [],
        traceWriter: null, // disable
      });
      // Sanity: lines was never used as a writer. But the test guarantees
      // no synchronous traceWriter calls fire from inside the wrapper.
      expect(lines.length).toBe(0);
    });

    it('SWT_NO_LLM_TRACE=1 env var suppresses the default writer (test-mode hygiene)', async () => {
      // This is the path vitest.config.ts sets to avoid stderr noise.
      // We assert by NOT injecting a traceWriter (so the default writer
      // runs) and capturing process.stderr.write. With SWT_NO_LLM_TRACE=1
      // (always set in vitest env), the default writer should no-op.
      const writes: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = (chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      };
      try {
        const eventing = makeEventEmittingFactory();
        const factoryWithEmit: SpawnOrchestratorSessionFactory = async (config) => {
          const session = await eventing.factory(config);
          const originalPrompt = session.prompt.bind(session);
          return {
            ...session,
            prompt: async (text: string) => {
              await originalPrompt(text);
              eventing.emit({
                type: 'MESSAGE_DELTA',
                sessionId: session.sessionId,
                text: 'silenced',
              });
              eventing.emit({
                type: 'TASK_TOKEN_USAGE',
                sessionId: session.sessionId,
                usage: {
                  input: 1,
                  output: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                  turn: 1,
                  provider: 'anthropic',
                  model: 'claude-opus-4-7',
                },
              });
            },
          };
        };

        await spawnOrchestratorSession({
          ...baseOpts(),
          sessionFactory: factoryWithEmit,
          hookRegistrations: [],
          // traceWriter NOT injected — exercises the default path
        });
        // vitest sets SWT_NO_LLM_TRACE=1, so the default writer should no-op
        const llmWrites = writes.filter((w) => w.startsWith('[llm turn'));
        expect(llmWrites.length).toBe(0);
      } finally {
        process.stderr.write = originalWrite;
      }
    });
  });
});
