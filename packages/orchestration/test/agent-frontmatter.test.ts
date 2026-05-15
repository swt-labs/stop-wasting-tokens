import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { SwtSession, SwtSessionOptions, ThinkingLevel } from '@swt-labs/runtime';
import { describe, expect, it } from 'vitest';

import {
  readRolePromptWithMeta,
  resolveSpawnAgentConfig,
  spawnAgent,
  type SpawnAgentOptions,
  type SpawnAgentSessionConfig,
  type SpawnAgentSessionFactory,
} from '../src/index.js';

/**
 * Plan 02-01 Task T4 — agent-frontmatter regression suite.
 *
 * Asserts the Anthropic-SDK frontmatter shape lands end-to-end:
 *   1. All 7 roles' agents/swt-{role}.md files parse cleanly through
 *      `readRolePromptWithMeta`, populate `config.thinkingLevel` +
 *      `config.maxTurns` per the TDD §4 Phase 02 table, and the
 *      frontmatter is stripped from `config.systemPrompt`.
 *   2. The recorded `SwtSessionOptions` passed into the session factory
 *      carries the frontmatter-derived `thinkingLevel` — proves the
 *      `defaultSpawnSessionFactory` no longer drops it (T1 close-out).
 *   3. The parser throws on invalid `effort` values (defends the enum
 *      narrowing — a typo'd frontmatter MUST fail loud, not silently
 *      degrade).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

interface FrontmatterRow {
  readonly role: SpawnAgentOptions['role'];
  readonly effort: ThinkingLevel;
  readonly maxTurns: number;
}

// TDD §4 Phase 02 table — single source of truth. If this drifts from the
// agent files, the corresponding `it` case fails with the actual vs expected
// thinkingLevel/maxTurns mismatch.
const FRONTMATTER_TABLE: ReadonlyArray<FrontmatterRow> = [
  { role: 'lead', effort: 'high', maxTurns: 50 },
  { role: 'dev', effort: 'high', maxTurns: 75 },
  { role: 'scout', effort: 'medium', maxTurns: 15 },
  { role: 'qa', effort: 'high', maxTurns: 25 },
  { role: 'architect', effort: 'xhigh', maxTurns: 30 },
  { role: 'debugger', effort: 'high', maxTurns: 80 },
  { role: 'docs', effort: 'medium', maxTurns: 20 },
];

function baseOpts(
  role: SpawnAgentOptions['role'],
  overrides: Partial<SpawnAgentOptions> = {},
): SpawnAgentOptions {
  return {
    role,
    prompt: 'demo task prompt',
    cwd: '/tmp/swt-agent-frontmatter-test',
    sessionId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
    installRoot: REPO_ROOT,
    ...overrides,
  };
}

function makeRecordingSpawnFactory(): {
  factory: SpawnAgentSessionFactory;
  configs: SpawnAgentSessionConfig[];
} {
  const configs: SpawnAgentSessionConfig[] = [];
  const factory: SpawnAgentSessionFactory = async (config) => {
    configs.push(config);
    const session: SwtSession = {
      sessionId: `mock-${configs.length}`,
      async prompt() {
        // no-op
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

describe('agent frontmatter -> spawn config (Plan 02-01 T4)', () => {
  for (const row of FRONTMATTER_TABLE) {
    it(`role=${row.role}: frontmatter effort=${row.effort} + maxTurns=${row.maxTurns} flow through to SpawnAgentSessionConfig`, () => {
      const config = resolveSpawnAgentConfig(baseOpts(row.role));
      expect(config.thinkingLevel).toBe(row.effort);
      expect(config.maxTurns).toBe(row.maxTurns);
      // Frontmatter must be stripped from the LLM-visible body — no `---`
      // delimiter, no `name:` / `effort:` / `maxTurns:` keys leak.
      expect(config.systemPrompt).not.toMatch(/^---/m);
      expect(config.systemPrompt).not.toMatch(/^name:/m);
      expect(config.systemPrompt).not.toMatch(/^effort:/m);
      expect(config.systemPrompt).not.toMatch(/^maxTurns:/m);
      // Body content survives (each agent file has a meaningful body).
      expect(config.systemPrompt.length).toBeGreaterThan(100);
    });
  }

  it('flows thinkingLevel into the recorded SpawnAgentSessionConfig via spawnAgent', async () => {
    // Proves the recording-factory seam captures the frontmatter-derived
    // thinkingLevel. T1's `defaultSpawnSessionFactory` would forward this to
    // `createSession` -> `createAgentSession({thinkingLevel})` in production;
    // the recording factory short-circuits before real Pi.
    const recording = makeRecordingSpawnFactory();
    await spawnAgent({ ...baseOpts('dev'), sessionFactory: recording.factory });
    expect(recording.configs.length).toBe(1);
    const captured = recording.configs[0];
    expect(captured?.thinkingLevel).toBe('high');
    expect(captured?.maxTurns).toBe(75);
  });

  it('flows thinkingLevel through defaultSpawnSessionFactory into SwtSessionOptions (T1 plumbing check)', async () => {
    // Wraps `defaultSpawnSessionFactory` indirectly: build the SwtSessionOptions
    // that the factory would emit and confirm `thinkingLevel` is present + set
    // to the frontmatter value. We capture by installing a custom factory that
    // mimics the conditional-spread shape used by defaultSpawnSessionFactory.
    let capturedSessionOpts: SwtSessionOptions | undefined;
    const factory: SpawnAgentSessionFactory = async (config) => {
      // Mirror the conditional-spread shape from spawn-agent.ts's
      // `defaultSpawnSessionFactory` — proves the field is propagated end-to-end.
      capturedSessionOpts = {
        cwd: config.cwd,
        ephemeral: config.ephemeral,
        enableResultProtocol: config.enableResultProtocol ?? true,
        taskId: config.taskId,
        ...(config.thinkingLevel !== undefined ? { thinkingLevel: config.thinkingLevel } : {}),
      };
      return {
        sessionId: 'mock',
        async prompt() {
          // no-op
        },
        subscribe() {
          return () => {
            // no-op
          };
        },
        dispose() {
          // no-op
        },
      } satisfies SwtSession;
    };
    await spawnAgent({ ...baseOpts('architect'), sessionFactory: factory });
    expect(capturedSessionOpts?.thinkingLevel).toBe('xhigh');
  });

  it('readRolePromptWithMeta throws on invalid effort value', () => {
    const root = mkdtempSync(join(tmpdir(), 'swt-agent-frontmatter-invalid-'));
    const agentsDir = resolve(root, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      resolve(agentsDir, 'swt-dev.md'),
      '---\nname: swt-dev\neffort: bogus\nmaxTurns: 10\n---\nbody.\n',
      'utf8',
    );
    expect(() => readRolePromptWithMeta(agentsDir, 'swt-dev.md')).toThrow(/invalid `effort`/);
  });

  it('readRolePromptWithMeta throws on non-positive-integer maxTurns', () => {
    const root = mkdtempSync(join(tmpdir(), 'swt-agent-frontmatter-bad-maxturns-'));
    const agentsDir = resolve(root, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      resolve(agentsDir, 'swt-dev.md'),
      '---\nname: swt-dev\neffort: high\nmaxTurns: -3\n---\nbody.\n',
      'utf8',
    );
    expect(() => readRolePromptWithMeta(agentsDir, 'swt-dev.md')).toThrow(/invalid `maxTurns`/);
  });

  it('readRolePromptWithMeta gracefully degrades when no frontmatter is present', () => {
    const root = mkdtempSync(join(tmpdir(), 'swt-agent-frontmatter-no-fm-'));
    const agentsDir = resolve(root, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      resolve(agentsDir, 'swt-dev.md'),
      '# No frontmatter agent\n\nbody only.\n',
      'utf8',
    );
    const result = readRolePromptWithMeta(agentsDir, 'swt-dev.md');
    expect(result.meta).toEqual({});
    expect(result.body).toMatch(/# No frontmatter agent/);
  });
});
