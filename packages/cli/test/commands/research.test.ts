/**
 * Plan 03-03 (Phase 3) Task T3 — swt research handler coverage.
 *
 * Coverage:
 *   - Registered in buildRegistry()
 *   - Requires a non-empty topic (USAGE_ERROR otherwise)
 *   - Calls spawnAgent with role: 'scout'
 *   - Loads commands/research.md (frontmatter stripped before LLM)
 *   - Substitutes ${SWT_TOPIC} placeholder
 *   - Returns EXIT.SUCCESS on TaskResult.status === 'success'
 *   - Returns EXIT.RUNTIME_ERROR on TaskResult.status === 'failed'
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TaskResult } from '@swt-labs/shared';

import { makeResearchHandler } from '../../src/commands/research.js';
import { buildRegistry } from '../../src/main.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-research-test-repo';
const TEST_SESSION_ID = 'research-test-session-id';

const STUB_RESEARCH_MD = `---
name: swt:research
description: Run standalone research by spawning Scout agent(s).
---

# SWT Research: \${SWT_TOPIC}

Research the topic: \${SWT_TOPIC}

Working directory: \${SWT_INSTALL_ROOT}
`;

interface HarnessOpts {
  readonly spawnResult?: Partial<TaskResult>;
  readonly spawnThrows?: Error;
}

function buildResearchHarness(opts: HarnessOpts = {}) {
  const spawnResult: TaskResult = {
    schema_version: 1,
    task_id: 'research-test-task',
    status: 'success',
    summary: 'ok',
    files_changed: [],
    must_haves: [],
    ...opts.spawnResult,
  };
  const spawnAgentImpl = vi.fn(async () => {
    if (opts.spawnThrows !== undefined) throw opts.spawnThrows;
    return spawnResult;
  });

  const readFileSyncImpl = vi.fn((_p: unknown, _enc?: unknown) => STUB_RESEARCH_MD);

  const handler = makeResearchHandler({
    spawnAgentImpl: spawnAgentImpl as never,
    readFileSyncImpl: readFileSyncImpl as never,
  });

  const stderr: string[] = [];
  const stdout: string[] = [];
  const io: CommandIO = {
    cwd: REPO_ROOT,
    stdout: {
      write: (chunk: string | Uint8Array) => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
  };

  async function run(positionals: readonly string[]) {
    return handler({ verb: 'research', positionals, flags: {} }, io);
  }

  return {
    run,
    spawnAgentImpl,
    readFileSyncImpl,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

describe('@swt-labs/cli — researchHandler (Plan 03-03 T3)', () => {
  it('is registered in buildRegistry() as a real verb (not a stub)', () => {
    const reg = buildRegistry();
    const spec = reg.get('research');
    expect(spec).toBeDefined();
    expect(spec?.description.toLowerCase()).toContain('scout');
  });

  it('returns USAGE_ERROR when no topic positional is supplied', async () => {
    const h = buildResearchHarness();
    const exit = await h.run([]);
    expect(exit).toBe(1);
    expect(h.spawnAgentImpl).not.toHaveBeenCalled();
    expect(h.stderr()).toContain('Usage');
  });

  it('calls spawnAgent exactly once with role="scout" and a joined topic in the prompt', async () => {
    const h = buildResearchHarness();
    const exit = await h.run(['rust', 'async', 'patterns']);
    expect(exit).toBe(0);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
    const args = h.spawnAgentImpl.mock.calls[0]?.[0];
    expect(args?.role).toBe('scout');
    expect(args?.prompt).toContain('rust async patterns');
    expect(args?.prompt).not.toContain('${SWT_TOPIC}');
  });

  it('loads commands/research.md and strips frontmatter before passing to spawnAgent', async () => {
    const h = buildResearchHarness();
    await h.run(['some topic']);
    const readPath = String(h.readFileSyncImpl.mock.calls[0]?.[0]);
    expect(readPath).toContain('commands');
    expect(readPath.endsWith('research.md')).toBe(true);
    const promptPassed = h.spawnAgentImpl.mock.calls[0]?.[0]?.prompt ?? '';
    expect(promptPassed.startsWith('---')).toBe(false);
    expect(promptPassed).not.toContain('name: swt:research');
    expect(promptPassed).toContain('# SWT Research:');
  });

  it('substitutes ${SWT_INSTALL_ROOT} placeholder in the prompt', async () => {
    const h = buildResearchHarness();
    await h.run(['topic']);
    const promptPassed = h.spawnAgentImpl.mock.calls[0]?.[0]?.prompt ?? '';
    expect(promptPassed).toContain(REPO_ROOT);
    expect(promptPassed).not.toContain('${SWT_INSTALL_ROOT}');
  });

  it('returns EXIT.SUCCESS on TaskResult.status === "success"', async () => {
    const h = buildResearchHarness({ spawnResult: { status: 'success' } });
    const exit = await h.run(['topic']);
    expect(exit).toBe(0);
  });

  it('returns EXIT.RUNTIME_ERROR on TaskResult.status === "failed"', async () => {
    const h = buildResearchHarness({ spawnResult: { status: 'failed' } });
    const exit = await h.run(['topic']);
    expect(exit).toBe(3);
    expect(h.stderr()).toContain('failed');
  });

  it('returns EXIT.RUNTIME_ERROR when spawnAgent throws', async () => {
    const h = buildResearchHarness({ spawnThrows: new Error('spawn boom') });
    const exit = await h.run(['topic']);
    expect(exit).toBe(3);
    expect(h.stderr()).toContain('spawn boom');
  });
});
