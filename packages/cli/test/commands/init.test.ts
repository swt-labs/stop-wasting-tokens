/**
 * Plan 03-03 (Phase 3) Task T5 — swt init handler coverage.
 *
 * Coverage:
 *   - Registered in buildRegistry()
 *   - Usage error when <name> is missing
 *   - Scaffold path (existing behaviour preserved)
 *   - --skip-lead bypasses spawnAgent (CI / smoke escape-hatch)
 *   - Default path spawns Lead exactly once with role: 'lead', loading
 *     commands/init.md (frontmatter stripped)
 *   - AlreadyInitializedError still surfaces as USAGE_ERROR
 *   - Lead spawn failure surfaces as RUNTIME_ERROR
 */

import { AlreadyInitializedError } from '@swt-labs/core';
import type { TaskResult } from '@swt-labs/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeInitHandler } from '../../src/commands/init.js';
import { buildRegistry } from '../../src/main.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-init-test-repo';
const TEST_SESSION_ID = 'init-test-session-id';

const STUB_INIT_MD = `---
name: swt:init
description: Bootstrap the SWT planning workspace.
---

# SWT Init

Detect stack for project: \${SWT_PROJECT_NAME}
Working directory: \${SWT_INSTALL_ROOT}
`;

interface HarnessOpts {
  readonly spawnResult?: Partial<TaskResult>;
  readonly spawnThrows?: Error;
  readonly initProjectThrows?: Error;
}

function buildInitHarness(opts: HarnessOpts = {}) {
  const spawnResult: TaskResult = {
    schema_version: 1,
    task_id: 'init-test-task',
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

  const readFileSyncImpl = vi.fn((_p: unknown, _enc?: unknown) => STUB_INIT_MD);

  const initProjectImpl = vi.fn(() => {
    if (opts.initProjectThrows !== undefined) throw opts.initProjectThrows;
    return { root: REPO_ROOT, files: ['.swt-planning/PROJECT.md', '.swt-planning/STATE.md'] };
  });

  const handler = makeInitHandler({
    spawnAgentImpl: spawnAgentImpl,
    readFileSyncImpl: readFileSyncImpl as never,
    initProjectImpl: initProjectImpl,
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
    positionals: readonly string[] = ['test-proj'],
    flags: Record<string, string | boolean | undefined> = {},
  ) {
    return handler({ verb: 'init', positionals, flags }, io);
  }

  return {
    run,
    spawnAgentImpl,
    readFileSyncImpl,
    initProjectImpl,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

describe('@swt-labs/cli — initHandler (Plan 03-03 T5)', () => {
  it('is registered in buildRegistry() as a real verb', () => {
    const reg = buildRegistry();
    const spec = reg.get('init');
    expect(spec).toBeDefined();
    expect(spec?.description.toLowerCase()).toContain('.swt-planning');
  });

  it('returns USAGE_ERROR when <name> positional is missing', async () => {
    const h = buildInitHarness();
    const exit = await h.run([]);
    expect(exit).toBe(1);
    expect(h.initProjectImpl).not.toHaveBeenCalled();
    expect(h.spawnAgentImpl).not.toHaveBeenCalled();
    expect(h.stderr()).toContain('Usage');
  });

  it('scaffolds .swt-planning/ (initProject called) then spawns Lead', async () => {
    const h = buildInitHarness();
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(0);
    expect(h.initProjectImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
    const args = h.spawnAgentImpl.mock.calls[0]?.[0];
    expect(args?.role).toBe('lead');
  });

  it('loads commands/init.md and strips frontmatter before passing to the Lead', async () => {
    const h = buildInitHarness();
    await h.run(['my-proj']);
    const readPath = String(h.readFileSyncImpl.mock.calls[0]?.[0]);
    expect(readPath.endsWith('init.md')).toBe(true);
    const promptPassed = h.spawnAgentImpl.mock.calls[0]?.[0]?.prompt ?? '';
    expect(promptPassed.startsWith('---')).toBe(false);
    expect(promptPassed).not.toContain('name: swt:init');
    // ${SWT_PROJECT_NAME} substitution applied
    expect(promptPassed).toContain('my-proj');
    expect(promptPassed).not.toContain('${SWT_PROJECT_NAME}');
  });

  it('--skip-lead bypasses the Lead spawn entirely (CI escape-hatch)', async () => {
    const h = buildInitHarness();
    const exit = await h.run(['my-proj'], { 'skip-lead': true });
    expect(exit).toBe(0);
    expect(h.initProjectImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnAgentImpl).not.toHaveBeenCalled();
    expect(h.stdout()).toContain('Skipping');
  });

  it('AlreadyInitializedError surfaces as USAGE_ERROR (regression — pre-Plan-03-03 behaviour)', async () => {
    const h = buildInitHarness({
      initProjectThrows: new AlreadyInitializedError('/tmp/swt-init-test-repo/.swt-planning'),
    });
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(1);
    expect(h.stderr()).toContain('already exists');
    expect(h.spawnAgentImpl).not.toHaveBeenCalled();
  });

  it('returns EXIT.RUNTIME_ERROR when the Lead spawn returns status="failed"', async () => {
    const h = buildInitHarness({ spawnResult: { status: 'failed' } });
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(3);
    expect(h.initProjectImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
  });

  it('returns EXIT.RUNTIME_ERROR when the Lead spawn throws', async () => {
    const h = buildInitHarness({ spawnThrows: new Error('spawn boom') });
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(3);
    expect(h.stderr()).toContain('spawn boom');
  });

  it('accepts a description via --description flag and forwards to initProject', async () => {
    const h = buildInitHarness();
    await h.run(['my-proj'], { description: 'A test project' });
    const call = h.initProjectImpl.mock.calls[0]?.[0];
    expect(call?.description).toBe('A test project');
  });

  it('accepts a description via second positional and forwards to initProject', async () => {
    const h = buildInitHarness();
    await h.run(['my-proj', 'A test project']);
    const call = h.initProjectImpl.mock.calls[0]?.[0];
    expect(call?.description).toBe('A test project');
  });
});
