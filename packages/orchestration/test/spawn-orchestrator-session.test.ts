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

import { describe, expect, it, vi } from 'vitest';

import type { SwtSession } from '@swt-labs/runtime';
import type { PiExtensionAPI, PiToolDefinition } from '@swt-labs/runtime';

import {
  readProviderOverlay,
  resolveOrchestratorSessionConfig,
  resolveSpawnAgentConfig,
  spawnOrchestratorSession,
  type SpawnOrchestratorSessionFactory,
  type SpawnOrchestratorSessionConfig,
} from '../src/index.js';

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
        registered.push(def as unknown as PiToolDefinition);
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
    expect(
      recording.configs[0]?.extensions.map((e) => e.name).sort(),
    ).toEqual(['journal', 'resultProtocol', 'swtAskUser']);
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
    const config = resolveOrchestratorSessionConfig(
      baseOpts({ askUserImpl: fakeAskUser as never }),
    );
    const askUserExt = config.extensions.find((e) => e.name === 'swtAskUser');
    const registered: PiToolDefinition[] = [];
    const fakePi: PiExtensionAPI = {
      registerTool: (def) => {
        registered.push(def as unknown as PiToolDefinition);
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
});
