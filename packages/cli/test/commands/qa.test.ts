/**
 * Plan 03-03 (Phase 3) Task T1 — swt qa handler coverage.
 *
 * Coverage:
 *   - Registered in buildRegistry()
 *   - Calls spawnAgent with role: 'qa'
 *   - Loads commands/qa.md (frontmatter stripped before passing to LLM)
 *   - Returns EXIT.SUCCESS on TaskResult.status === 'success'
 *   - Returns EXIT.RUNTIME_ERROR on TaskResult.status === 'failed'
 */

import type { PhaseDetectResult } from '@swt-labs/methodology';
import type * as SwtRuntime from '@swt-labs/runtime';
import type { TaskResult } from '@swt-labs/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Phase 03 G-03 T5: controllable mock for resolveInstallRoot — toggled in the
// missing-precondition test below. Defaults to passthrough so existing tests
// see the real runtime resolver (which honors process.env.SWT_INSTALL_ROOT).
const runtimeMockState = vi.hoisted(() => ({ resolveInstallRootShouldThrow: false }));
vi.mock('@swt-labs/runtime', async () => {
  const actual = await vi.importActual<typeof SwtRuntime>('@swt-labs/runtime');
  return {
    ...actual,
    resolveInstallRoot: () => {
      if (runtimeMockState.resolveInstallRootShouldThrow) {
        throw new Error(
          'swt:installRoot — could not locate the SWT package root. Set SWT_INSTALL_ROOT explicitly.',
        );
      }
      return actual.resolveInstallRoot();
    },
  };
});

import { makeQaHandler } from '../../src/commands/qa.js';
import { buildRegistry } from '../../src/main.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-qa-test-repo';
const TEST_SESSION_ID = 'qa-test-session-id';

const STUB_QA_MD = `---
name: swt:qa
description: Run deep verification on completed phase work using the QA agent.
allowed-tools: Read, Write, Bash
---

# SWT QA: \${SWT_PHASE_TARGET}

## Context
Working directory: \${SWT_INSTALL_ROOT}

Run QA on phase \${SWT_PHASE_TARGET}.
`;

interface HarnessOpts {
  readonly spawnResult?: Partial<TaskResult>;
  readonly spawnThrows?: Error;
  readonly phaseDetect?: Partial<PhaseDetectResult>;
}

function buildQaHarness(opts: HarnessOpts = {}) {
  const spawnResult: TaskResult = {
    schema_version: 1,
    task_id: 'qa-test-task',
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

  const readFileSyncImpl = vi.fn((_p: unknown, _enc?: unknown) => STUB_QA_MD);

  const detectPhaseImpl = vi.fn(
    async () =>
      ({
        next_phase: '02',
        ...opts.phaseDetect,
      }) as PhaseDetectResult,
  );

  const handler = makeQaHandler({
    spawnAgentImpl: spawnAgentImpl,
    readFileSyncImpl: readFileSyncImpl as never,
    detectPhaseImpl: detectPhaseImpl,
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

  async function run(
    positionals: readonly string[] = [],
    flags: Record<string, string | boolean | undefined> = {},
  ) {
    return handler({ verb: 'qa', positionals, flags }, io);
  }

  return {
    run,
    spawnAgentImpl,
    readFileSyncImpl,
    detectPhaseImpl,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

describe('@swt-labs/cli — qaHandler (Plan 03-03 T1)', () => {
  it('is registered in buildRegistry() as a real verb (not a stub)', () => {
    const reg = buildRegistry();
    const spec = reg.get('qa');
    expect(spec).toBeDefined();
    expect(spec?.description.toLowerCase()).toContain('qa');
  });

  it('calls spawnAgent exactly once with role="qa"', async () => {
    const h = buildQaHarness();
    const exit = await h.run(['01']);
    expect(exit).toBe(0);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
    const args = h.spawnAgentImpl.mock.calls[0]?.[0];
    expect(args?.role).toBe('qa');
  });

  it('loads commands/qa.md and strips frontmatter before passing to spawnAgent', async () => {
    const h = buildQaHarness();
    await h.run(['01']);
    expect(h.readFileSyncImpl).toHaveBeenCalled();
    const readPath = String(h.readFileSyncImpl.mock.calls[0]?.[0]);
    expect(readPath).toContain('commands');
    expect(readPath.endsWith('qa.md')).toBe(true);
    const promptPassed = h.spawnAgentImpl.mock.calls[0]?.[0]?.prompt ?? '';
    // Frontmatter MUST be stripped — the leading --- block should not survive
    expect(promptPassed.startsWith('---')).toBe(false);
    expect(promptPassed).not.toContain('name: swt:qa');
    // Body should retain the user-facing header
    expect(promptPassed).toContain('# SWT QA:');
  });

  it('substitutes ${SWT_INSTALL_ROOT} placeholder in the prompt', async () => {
    const h = buildQaHarness();
    await h.run(['01']);
    const promptPassed = h.spawnAgentImpl.mock.calls[0]?.[0]?.prompt ?? '';
    expect(promptPassed).toContain(REPO_ROOT);
    expect(promptPassed).not.toContain('${SWT_INSTALL_ROOT}');
  });

  it('falls back to detectPhase() when no positional phase argument is supplied', async () => {
    const h = buildQaHarness({ phaseDetect: { next_phase: '07' } });
    await h.run([]);
    expect(h.detectPhaseImpl).toHaveBeenCalledTimes(1);
    const promptPassed = h.spawnAgentImpl.mock.calls[0]?.[0]?.prompt ?? '';
    expect(promptPassed).toContain('07');
  });

  it('returns EXIT.SUCCESS on TaskResult.status === "success"', async () => {
    const h = buildQaHarness({ spawnResult: { status: 'success' } });
    const exit = await h.run(['01']);
    expect(exit).toBe(0);
  });

  it('returns EXIT.RUNTIME_ERROR on TaskResult.status === "failed"', async () => {
    const h = buildQaHarness({ spawnResult: { status: 'failed' } });
    const exit = await h.run(['01']);
    expect(exit).toBe(3);
    expect(h.stderr()).toContain('failed');
  });

  it('returns EXIT.RUNTIME_ERROR when spawnAgent throws', async () => {
    const h = buildQaHarness({ spawnThrows: new Error('spawn boom') });
    const exit = await h.run(['01']);
    expect(exit).toBe(3);
    expect(h.stderr()).toContain('spawn boom');
  });

  // Phase 03 G-03 T5: missing-precondition regression — handler must hard-fail
  // when resolveInstallRoot throws (i.e., SWT_INSTALL_ROOT cannot be resolved
  // and the import.meta.url walk fails). Per Locked Decision #6.
  it('exits EXIT.RUNTIME_ERROR when resolveInstallRoot throws (SWT_INSTALL_ROOT unresolvable)', async () => {
    runtimeMockState.resolveInstallRootShouldThrow = true;
    try {
      const h = buildQaHarness();
      const exit = await h.run(['01']);
      expect(exit).toBe(3);
      expect(h.stderr()).toContain('SWT_INSTALL_ROOT');
    } finally {
      runtimeMockState.resolveInstallRootShouldThrow = false;
    }
  });
});
