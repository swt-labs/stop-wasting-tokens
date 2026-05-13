import { resolve } from 'node:path';

import type { SwtSession } from '@swt-labs/runtime';
import { describe, expect, it } from 'vitest';

import {
  resolveSpawnAgentConfig,
  spawnAgent,
  type SpawnAgentOptions,
  type SpawnAgentSessionConfig,
  type SpawnAgentSessionFactory,
} from '../src/index.js';

/**
 * Plan 01-01 Task T04 — spawnAgent invariants.
 *
 * Five assertions per the plan's verify block:
 *   1. role='dev' — resolved tool list does NOT contain a tool whose name
 *      matches /ask.?user/i. This is the single most important regression
 *      guard for Phase 1 (TDD3 §20.3 / §24).
 *   2. role='docs' — spawnAgent succeeds (regression guard for the
 *      AgentRole 'docs' gap closed in T02).
 *   3. role='scout' — resolved tool list matches the readonly bundle
 *      (no `write` / `edit` tool).
 *   4. The extensions array includes BOTH resultProtocol AND journal
 *      extension factories; the journal sink path is
 *      `.swt-planning/.transcripts/{sessionId}.jsonl`.
 *   5. maxTurns defaults to `config.agent_max_turns[role]` when caller omits.
 *
 * Test seam: a recording `SpawnAgentSessionFactory` that captures the
 * resolved `SpawnAgentSessionConfig` without going through real Pi. Per the
 * plan's "MockSpawnerEnvironment pattern" cue, the orchestration tests
 * already use injected SessionFactory closures (see dispatcher.test.ts);
 * the same pattern applies one layer up at spawn-agent.test.ts.
 */

// The repo root contains `agents/swt-{role}.md` files; tests resolve the
// install root via __dirname climbing up to /packages/orchestration/test → repo.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function makeRecordingFactory(): {
  factory: SpawnAgentSessionFactory;
  configs: SpawnAgentSessionConfig[];
} {
  const configs: SpawnAgentSessionConfig[] = [];
  const factory: SpawnAgentSessionFactory = async (config) => {
    configs.push(config);
    const session: SwtSession = {
      sessionId: `mock-${configs.length}`,
      async prompt() {
        // no-op — the dispatcher's stub harvest strategy returns a synthetic
        // success without inspecting any prompt output.
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

function baseOpts(
  role: SpawnAgentOptions['role'],
  overrides: Partial<SpawnAgentOptions> = {},
): SpawnAgentOptions {
  const { factory } = makeRecordingFactory();
  return {
    role,
    prompt: 'demo task prompt',
    cwd: '/tmp/swt-spawn-agent-test',
    sessionId: '11111111-2222-3333-4444-555555555555',
    installRoot: REPO_ROOT,
    sessionFactory: factory,
    ...overrides,
  };
}

describe('@swt-labs/orchestration — swt:spawnAgent (Plan 01-01 T04)', () => {
  describe('orchestrator-only askUser invariant', () => {
    it("role='dev' — resolved tool list does NOT contain any tool whose name matches /ask.?user/i", () => {
      const opts = baseOpts('dev');
      const config = resolveSpawnAgentConfig(opts);
      // The tools list comes from `toolsForRole('dev', cwd) =
      // createCodingTools(cwd)`. None of the Pi built-in tools are named
      // anything like "ask_user" / "askUser". swt:spawnAgent intentionally
      // adds NO custom tool to spawned roles' tool registries — askUser is
      // an orchestrator-only custom tool wired in plan 01-05, never here.
      for (const tool of config.tools) {
        const name = (tool as { name?: string }).name ?? '';
        expect(
          /ask.?user/i.test(name),
          `tool ${name} should not match /ask.?user/i in a spawned role's tools`,
        ).toBe(false);
      }
      // Belt-and-suspenders: the extensions[] list registers `swt_report_result`
      // (Result Protocol) and the journal — neither matches askUser.
      const extNames = config.extensions.map((e) => e.name);
      expect(extNames).toContain('resultProtocol');
      expect(extNames).toContain('journal');
      expect(extNames.some((n) => /ask.?user/i.test(n))).toBe(false);
    });

    it("role='qa' — same askUser-exclusion (regression guard across roles)", () => {
      const config = resolveSpawnAgentConfig(baseOpts('qa'));
      for (const tool of config.tools) {
        const name = (tool as { name?: string }).name ?? '';
        expect(/ask.?user/i.test(name)).toBe(false);
      }
    });

    it("role='scout' — same askUser-exclusion (regression guard across roles)", () => {
      const config = resolveSpawnAgentConfig(baseOpts('scout'));
      for (const tool of config.tools) {
        const name = (tool as { name?: string }).name ?? '';
        expect(/ask.?user/i.test(name)).toBe(false);
      }
    });
  });

  describe("role='docs' regression guard (Plan 01-01 T02 type gap)", () => {
    it('spawnAgent succeeds for role docs and reaches the session factory', async () => {
      const recording = makeRecordingFactory();
      const result = await spawnAgent({
        ...baseOpts('docs'),
        sessionFactory: recording.factory,
      });
      // The dispatcher's default `stub` harvest returns a synthetic success.
      // The contract here is "spawnAgent did not throw and dispatched a
      // task" — once real Pi wiring lands the status check tightens.
      expect(result.schema_version).toBe(1);
      expect(result.status).toBe('success');
      expect(recording.configs.length).toBe(1);
      expect(recording.configs[0]?.role).toBe('docs');
      // Sanity — docs gets the coding bundle (per role-router T02 change).
      expect(recording.configs[0]?.tools.length).toBeGreaterThan(0);
    });

    it("resolveSpawnAgentConfig accepts role='docs' without throwing", () => {
      expect(() => resolveSpawnAgentConfig(baseOpts('docs'))).not.toThrow();
    });
  });

  describe("role='scout' tool subset (readonly, no write)", () => {
    it('resolved tool list does NOT include `write` or `edit` (readonly bundle)', () => {
      const config = resolveSpawnAgentConfig(baseOpts('scout'));
      const names = config.tools.map((t) => (t as { name?: string }).name ?? '');
      // Pi's createReadOnlyTools (per the SDK type def at
      // node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.d.ts:38)
      // returns only read-oriented tools. Both `write` and `edit` are
      // coding-bundle-only — they must NOT appear in scout's tool list.
      expect(names).not.toContain('write');
      expect(names).not.toContain('edit');
    });

    it('resolved tool list still includes `read` (read-only bundle is non-empty)', () => {
      const config = resolveSpawnAgentConfig(baseOpts('scout'));
      const names = config.tools.map((t) => (t as { name?: string }).name ?? '');
      expect(names).toContain('read');
    });
  });

  describe('extensions array (Result Protocol + Journal w/ transcript path)', () => {
    it('includes both resultProtocol and journal extension factories', () => {
      const config = resolveSpawnAgentConfig(baseOpts('dev'));
      const names = config.extensions.map((e) => e.name);
      expect(names).toContain('resultProtocol');
      expect(names).toContain('journal');
      // Factories are callable functions (the (pi) => void shape).
      for (const ext of config.extensions) {
        expect(typeof ext.factory).toBe('function');
      }
    });

    it('transcript path is `<cwd>/.swt-planning/.transcripts/<sessionId>.jsonl`', () => {
      const opts = baseOpts('dev', {
        cwd: '/tmp/spawn-test-cwd',
        sessionId: 'abcd1234-5678-90ab-cdef-1234567890ab',
      });
      const config = resolveSpawnAgentConfig(opts);
      expect(config.transcriptPath).toBe(
        '/tmp/spawn-test-cwd/.swt-planning/.transcripts/abcd1234-5678-90ab-cdef-1234567890ab.jsonl',
      );
    });
  });

  describe('maxTurns default from config/defaults.json#agent_max_turns', () => {
    it("defaults role='dev' to 75 when caller omits maxTurns", () => {
      const config = resolveSpawnAgentConfig(baseOpts('dev'));
      expect(config.maxTurns).toBe(75);
    });

    it("defaults role='scout' to 15", () => {
      const config = resolveSpawnAgentConfig(baseOpts('scout'));
      expect(config.maxTurns).toBe(15);
    });

    it("defaults role='architect' to 30", () => {
      const config = resolveSpawnAgentConfig(baseOpts('architect'));
      expect(config.maxTurns).toBe(30);
    });

    it("defaults role='debugger' to 80", () => {
      const config = resolveSpawnAgentConfig(baseOpts('debugger'));
      expect(config.maxTurns).toBe(80);
    });

    it('honours an explicit maxTurns override', () => {
      const config = resolveSpawnAgentConfig(baseOpts('dev', { maxTurns: 7 }));
      expect(config.maxTurns).toBe(7);
    });
  });

  describe('miscellaneous invariants', () => {
    it("rejects role='orchestrator' (the orchestrator is the caller, not spawnable)", () => {
      expect(() =>
        resolveSpawnAgentConfig({
          role: 'orchestrator',
          prompt: 'x',
          cwd: '/tmp',
          sessionId: 's',
          installRoot: REPO_ROOT,
        }),
      ).toThrow(/cannot spawn role "orchestrator"/);
    });

    it('reads the role system prompt from `<installRoot>/agents/swt-{role}.md`', () => {
      const config = resolveSpawnAgentConfig(baseOpts('dev'));
      // The systemPrompt is the full file body — non-empty + recognisable.
      expect(config.systemPrompt.length).toBeGreaterThan(0);
      expect(config.systemPrompt).toMatch(/name:\s*swt-dev/);
    });

    it("sets sandbox_mode='workspace-write' for dev / lead / debugger / docs / architect", () => {
      for (const role of ['dev', 'lead', 'debugger', 'docs', 'architect'] as const) {
        const config = resolveSpawnAgentConfig(baseOpts(role));
        expect(config.sandboxMode, `${role} sandbox_mode`).toBe('workspace-write');
      }
    });

    it("sets sandbox_mode='read-only' for scout and qa", () => {
      for (const role of ['scout', 'qa'] as const) {
        const config = resolveSpawnAgentConfig(baseOpts(role));
        expect(config.sandboxMode, `${role} sandbox_mode`).toBe('read-only');
      }
    });

    it('threads sessionFactory through to dispatch (records the resolved config exactly once)', async () => {
      const recording = makeRecordingFactory();
      await spawnAgent({ ...baseOpts('dev'), sessionFactory: recording.factory });
      expect(recording.configs.length).toBe(1);
      const captured = recording.configs[0];
      expect(captured?.role).toBe('dev');
      expect(captured?.cwd).toBe('/tmp/swt-spawn-agent-test');
      expect(captured?.extensions.map((e) => e.name).sort()).toEqual(['journal', 'resultProtocol']);
    });
  });
});
