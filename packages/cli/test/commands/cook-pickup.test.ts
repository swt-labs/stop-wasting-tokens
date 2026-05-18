/**
 * Plan 15-04-01 T5 — integration tests for the `cookHandler`:
 *
 *   describe('cookHandler bare-integer pickup')
 *     1. `swt cook 3` + fresh unfiltered snapshot + details present →
 *        spawnFn receives a prompt whose trailer contains `- ref_hash: <hash>`
 *        AND `- extended_context: Extended context (from todo detail): ...`
 *        AND the substituted description appears in the routing input.
 *     2. `swt cook 3` + stale snapshot → routes via phase-target = 3 with
 *        one `[cook] snapshot stale` stderr line.
 *     3. `swt cook 3` + filtered snapshot → routes via phase-target = 3
 *        with one `[cook] snapshot is filtered` stderr line.
 *     4. `swt cook 3` + missing snapshot → routes via phase-target = 3
 *        with NO `[cook] snapshot` stderr line (silent zero-behavior-change
 *        — AC-03 + AC-08).
 *     5. `swt cook 99` + fresh snapshot with 5 refs → out-of-range silent
 *        fall-through to phase-target = 99.
 *
 *   describe('cookHandler --todo escape hatch')
 *     6.  `swt cook --todo 3` + fresh snapshot → pickup; trailer matches.
 *     7.  `swt cook --todo 3` + stale snapshot → pickup succeeds
 *         (escape-hatch bypasses TTL); trailer matches.
 *     8.  `swt cook --todo 3` + filtered snapshot → pickup succeeds
 *         (escape-hatch bypasses filter); trailer matches.
 *     9.  `swt cook --todo 3` + missing snapshot → USAGE_ERROR.
 *     10. `swt cook --todo 99` + fresh snapshot with 5 refs → USAGE_ERROR
 *         `out of range (snapshot has 5 todos)`.
 *     11. `swt cook --todo 0` → USAGE_ERROR `must be a positive integer`.
 *     12. `swt cook --todo abc` → USAGE_ERROR `must be a positive integer`.
 *     13. `swt cook --todo 3 --plan 05` → USAGE_ERROR
 *         `--todo and --plan are mutually exclusive`.
 *     14. `swt cook --todo 3 --execute` → USAGE_ERROR
 *         `--todo and --execute are mutually exclusive`.
 *     15. `swt cook --todo 3 4` → USAGE_ERROR
 *         `bare positional integer are mutually exclusive`.
 *
 *   describe('cookHandler extended-context injection')
 *     16. `(ref:HASH)` + details[hash] = {detail, files: [a, b]} →
 *         trailer contains the full extended_context line with Related
 *         files.
 *     17. `(ref:HASH)` + details[hash] = {detail, files: []} →
 *         trailer line OMITS the `Related files: ...` clause.
 *     18. `(ref:HASH)` + details[hash] = {description, files: [...]}
 *         (no `detail` field) → trailer does NOT contain
 *         `extended_context:` (graceful degradation).
 *     19. `(ref:HASH)` + details[hash] absent → trailer does NOT
 *         contain `extended_context:` + stderr contains
 *         `ref hash <hash> not found`.
 *
 * Test harness mirrors `cook-seed-from-positional.test.ts` (vitest +
 * `makeCookHandler` with injected fakes), but uses a real `tmpdir + mkdtemp`
 * sandbox for `io.cwd` because `readSnapshotForPickup` and
 * `loadTodoDetailForRef` use `fs/promises.readFile` — those are NOT
 * injected; tests need a real filesystem under the test's cwd.
 */

import type { execSync as ExecSyncFn } from 'node:child_process';
import type { PathLike, PathOrFileDescriptor } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PhaseDetectResult } from '@swt-labs/methodology';
import type { AskUserResponse } from '@swt-labs/runtime';
import type { ListTodosSnapshot, TaskResult, TodoDetail, TodoDetailsFile } from '@swt-labs/shared';
import { LIST_TODOS_SNAPSHOT_TTL_MS } from '@swt-labs/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookHandler } from '../../src/commands/cook.js';
import { EXIT } from '../../src/exit-codes.js';
import type { CommandIO } from '../../src/router.js';

const TEST_SESSION_ID = 'cook-pickup-session';

function makePhaseDetect(overrides: Partial<PhaseDetectResult> = {}): PhaseDetectResult {
  return {
    jq_available: true,
    planning_dir_exists: true,
    project_exists: true,
    phases_dir: '.swt-planning/phases',
    has_shipped_milestones: false,
    needs_milestone_rename: false,
    phase_count: 1,
    next_phase: '01',
    next_phase_slug: '01-foo',
    next_phase_state: 'needs_execute',
    next_phase_plans: 1,
    next_phase_summaries: 0,
    has_unverified_phases: false,
    first_unverified_phase: undefined,
    first_unverified_slug: undefined,
    first_qa_attention_phase: undefined,
    first_qa_attention_slug: undefined,
    qa_attention_status: 'none',
    qa_attention_reason: 'none',
    qa_status: 'none',
    qa_reason: '',
    qa_round: '00',
    uat_issues_phase: 'none',
    uat_issues_slug: 'none',
    uat_issues_major_or_higher: false,
    uat_issues_phases: '',
    uat_issues_count: 0,
    uat_file: 'none',
    uat_round_count: 0,
    misnamed_plans: false,
    milestone_uat_issues: false,
    milestone_uat_phase: 'none',
    milestone_uat_slug: 'none',
    milestone_uat_major_or_higher: false,
    milestone_uat_phase_dir: 'none',
    milestone_uat_count: 0,
    milestone_uat_phase_dirs: '',
    config_effort: 'balanced',
    config_autonomy: 'standard',
    config_auto_commit: true,
    config_planning_tracking: 'manual',
    config_auto_push: 'never',
    config_verification_tier: 'standard',
    config_prefer_teams: 'auto',
    config_max_tasks_per_plan: 5,
    config_context_compiler: true,
    config_require_phase_discussion: false,
    config_auto_uat: false,
    config_compaction_threshold: 130000,
    has_codebase_map: false,
    brownfield: false,
    execution_state: 'none',
    phase_detect_complete: true,
    ...overrides,
  };
}

const STUB_COOK_MD = `---
name: swt:cook
---

# SWT Cook

### Mode: Bootstrap

Bootstrap body.

### Mode: Scope

Scope body. \${SEED_IDEA}

### Mode: Discuss

Discuss body.

### Mode: Assumptions

Assumptions body.

### Mode: UAT Remediation

UAT Remediation body.

### Mode: Milestone UAT Recovery

Milestone UAT Recovery body.

### Mode: Plan

Plan body.

### Mode: Execute

Execute body.

### Mode: Verify

Verify body.

### Mode: Add Phase

Add Phase body.

### Mode: Insert Phase

Insert Phase body.

### Mode: Remove Phase

Remove Phase body.

### Mode: Archive

Archive body.
`;

let cwd: string;

beforeAll(() => {
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-cook-pickup-'));
  await mkdir(join(cwd, '.swt-planning'), { recursive: true });
  process.env['SWT_INSTALL_ROOT'] = cwd;
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

interface HarnessOpts {
  readonly state?: PhaseDetectResult;
  readonly askResponses?: ReadonlyArray<AskUserResponse>;
}

function buildHarness(opts: HarnessOpts = {}): {
  run: (
    positionals?: readonly string[],
    flags?: Record<string, string | boolean | undefined>,
  ) => Promise<number>;
  spawnImpl: ReturnType<typeof vi.fn>;
  stderr: () => string;
  stdout: () => string;
} {
  const state = opts.state ?? makePhaseDetect();
  const askResponses = opts.askResponses ?? [];
  let askIdx = 0;
  const askUserImpl = vi.fn(async () => {
    const r = askResponses[askIdx];
    askIdx += 1;
    if (r !== undefined) return r;
    return { selectedOption: 'Yes', freeform: null };
  });

  const spawnResult: TaskResult = {
    schema_version: 1,
    task_id: 'cook-pickup-test-task',
    status: 'success',
    summary: 'ok',
    files_changed: [],
    must_haves: [],
  };
  const spawnImpl = vi.fn(async () => spawnResult);
  const detectPhaseImpl = vi.fn(async () => state);
  const execSyncImpl = vi.fn(
    ((_cmd: string, _opts: unknown) => '') as unknown as typeof ExecSyncFn,
  );

  // Production-realistic readFileSync — returns the stub cook.md for the
  // install-root cook.md lookup; everything else falls through to the
  // real node fs (which the helper modules use under the hood via
  // fs/promises). Crucially, the seed-idea read uses readFileSyncImpl
  // too — we DON'T pre-seed it, so the existsSyncImpl below returns false
  // for that path.
  const readFileSyncImpl = vi.fn((p: PathOrFileDescriptor, _enc?: unknown) => {
    if (String(p).endsWith('commands/cook.md')) {
      return STUB_COOK_MD;
    }
    return '';
  });
  const existsSyncImpl = vi.fn((p: PathLike) => {
    // Make the cook.md lookup succeed; everything else (notably the
    // seed-idea file) reports absent so the resume probe + seed path
    // stay no-op for this suite.
    if (String(p).endsWith('commands/cook.md')) return true;
    return false;
  });
  const writeFileSyncImpl = vi.fn(
    (_p: PathOrFileDescriptor, _data: unknown, _enc?: unknown) => undefined,
  );

  const handler = makeCookHandler({
    detectPhaseImpl,
    askUserImpl,
    spawnOrchestratorSessionImpl: spawnImpl,
    execSyncImpl: execSyncImpl as never,
    readFileSyncImpl: readFileSyncImpl as never,
    existsSyncImpl,
    writeFileSyncImpl,
  });

  const stderr: string[] = [];
  const stdout: string[] = [];
  const io: CommandIO = {
    cwd,
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
  ): Promise<number> {
    return handler({ verb: 'cook', positionals, flags }, io);
  }

  return {
    run,
    spawnImpl,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

function buildSnapshot(overrides: Partial<ListTodosSnapshot> = {}): ListTodosSnapshot {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    filter: null,
    refs: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'],
    ...overrides,
  };
}

async function writeSnapshotFixture(snapshot: ListTodosSnapshot): Promise<void> {
  await mkdir(join(cwd, '.swt-planning', '.cache'), { recursive: true });
  await writeFile(
    join(cwd, '.swt-planning', '.cache', 'list-todos-snapshot.json'),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
}

async function writeDetailsFixture(file: TodoDetailsFile): Promise<void> {
  await mkdir(join(cwd, '.swt-planning'), { recursive: true });
  await writeFile(
    join(cwd, '.swt-planning', 'todo-details.json'),
    JSON.stringify(file, null, 2),
    'utf8',
  );
}

function buildDetail(overrides: Partial<TodoDetail> = {}): TodoDetail {
  return {
    description: 'fix login button on Safari',
    created_at: '2026-05-17',
    ...overrides,
  };
}

function getSpawnedPrompt(spawnImpl: ReturnType<typeof vi.fn>): string {
  const callArg = spawnImpl.mock.calls[0]?.[0];
  if (typeof callArg !== 'object' || callArg === null) {
    throw new Error('expected spawnImpl to be called with an object');
  }
  const promptVal = (callArg as Record<string, unknown>)['prompt'];
  if (typeof promptVal !== 'string') {
    throw new Error('expected spawnImpl call arg to carry a string prompt');
  }
  return promptVal;
}

describe('@swt-labs/cli — cookHandler bare-integer pickup (Plan 15-04-01 T5)', () => {
  it('bare 3 + fresh unfiltered snapshot + details present → todo pickup with extended_context trailer', async () => {
    const snapshot = buildSnapshot();
    await writeSnapshotFixture(snapshot);
    const detail = buildDetail({
      description: 'fix login button on Safari',
      detail: 'the login button is broken on Safari',
      files: ['src/Login.tsx', 'src/auth/session.ts'],
    });
    await writeDetailsFixture({
      schema_version: 1,
      todos: { cccccccc: detail },
    });
    const h = buildHarness();
    const code = await h.run(['3']);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- ref_hash: cccccccc');
    expect(prompt).toContain(
      '- extended_context: Extended context (from todo detail): the login button is broken on Safari. Related files: src/Login.tsx, src/auth/session.ts.',
    );
    expect(h.stderr()).not.toMatch(/\[cook\] snapshot/);
  });

  it('bare 3 + stale snapshot → fall-through (no ref_hash) with `[cook] snapshot stale` notice', async () => {
    const staleTs = new Date(Date.now() - LIST_TODOS_SNAPSHOT_TTL_MS - 60_000).toISOString();
    await writeSnapshotFixture(buildSnapshot({ generated_at: staleTs }));
    const h = buildHarness();
    const code = await h.run(['3']);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.stderr()).toMatch(/\[cook\] snapshot stale/);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    // Bare-integer fall-through routes via Path 3 (state detection),
    // NOT pickup — assert the trailer carries no pickup-only fields.
    expect(prompt).not.toContain('- ref_hash:');
    expect(prompt).not.toContain('- extended_context:');
  });

  it('bare 3 + filtered snapshot → fall-through (no ref_hash) with `[cook] snapshot is filtered` notice', async () => {
    await writeSnapshotFixture(buildSnapshot({ filter: { phase: '03' } }));
    const h = buildHarness();
    const code = await h.run(['3']);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.stderr()).toMatch(/\[cook\] snapshot is filtered/);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).not.toContain('- ref_hash:');
    expect(prompt).not.toContain('- extended_context:');
  });

  it('bare 3 + missing snapshot → fall-through (no ref_hash) with NO `[cook] snapshot` notice (silent zero-behavior-change)', async () => {
    const h = buildHarness();
    const code = await h.run(['3']);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.stderr()).not.toMatch(/\[cook\] snapshot/);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).not.toContain('- ref_hash:');
    expect(prompt).not.toContain('- extended_context:');
  });

  it('bare 99 + fresh snapshot with 5 refs → out-of-range silent fall-through (no ref_hash, no debug log)', async () => {
    await writeSnapshotFixture(buildSnapshot());
    const h = buildHarness();
    const code = await h.run(['99']);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.stderr()).not.toMatch(/\[cook\] snapshot/);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).not.toContain('- ref_hash:');
    expect(prompt).not.toContain('- extended_context:');
  });
});

describe('@swt-labs/cli — cookHandler --todo escape hatch (Plan 15-04-01 T5)', () => {
  it('--todo 3 + fresh snapshot → pickup; trailer carries ref_hash + extended_context', async () => {
    await writeSnapshotFixture(buildSnapshot());
    await writeDetailsFixture({
      schema_version: 1,
      todos: {
        cccccccc: buildDetail({
          detail: 'long context for the picked todo',
          files: ['a.ts'],
        }),
      },
    });
    const h = buildHarness();
    const code = await h.run([], { todo: '3' });
    expect(code).toBe(EXIT.SUCCESS);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- ref_hash: cccccccc');
    expect(prompt).toContain(
      '- extended_context: Extended context (from todo detail): long context for the picked todo. Related files: a.ts.',
    );
  });

  it('--todo 3 + stale snapshot → pickup succeeds (escape-hatch bypasses TTL)', async () => {
    const staleTs = new Date(Date.now() - LIST_TODOS_SNAPSHOT_TTL_MS - 60_000).toISOString();
    await writeSnapshotFixture(buildSnapshot({ generated_at: staleTs }));
    await writeDetailsFixture({
      schema_version: 1,
      todos: {
        cccccccc: buildDetail({ detail: 'stale-but-picked' }),
      },
    });
    const h = buildHarness();
    const code = await h.run([], { todo: '3' });
    expect(code).toBe(EXIT.SUCCESS);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- ref_hash: cccccccc');
    expect(prompt).toContain(
      '- extended_context: Extended context (from todo detail): stale-but-picked.',
    );
  });

  it('--todo 3 + filtered snapshot → pickup succeeds (escape-hatch bypasses filter)', async () => {
    await writeSnapshotFixture(buildSnapshot({ filter: { phase: '03' } }));
    await writeDetailsFixture({
      schema_version: 1,
      todos: { cccccccc: buildDetail({ detail: 'filtered-but-picked' }) },
    });
    const h = buildHarness();
    const code = await h.run([], { todo: '3' });
    expect(code).toBe(EXIT.SUCCESS);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- ref_hash: cccccccc');
    expect(prompt).toContain(
      '- extended_context: Extended context (from todo detail): filtered-but-picked.',
    );
  });

  it('--todo 3 + missing snapshot → USAGE_ERROR with `requires a list-todos snapshot`', async () => {
    const h = buildHarness();
    const code = await h.run([], { todo: '3' });
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(h.spawnImpl).not.toHaveBeenCalled();
    expect(h.stderr()).toMatch(/--todo N requires a list-todos snapshot/);
  });

  it('--todo 99 + fresh snapshot with 5 refs → USAGE_ERROR `out of range (snapshot has 5 todos)`', async () => {
    await writeSnapshotFixture(buildSnapshot());
    const h = buildHarness();
    const code = await h.run([], { todo: '99' });
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(h.spawnImpl).not.toHaveBeenCalled();
    expect(h.stderr()).toMatch(/out of range \(snapshot has 5 todos\)/);
  });

  it('--todo 0 → USAGE_ERROR `must be a positive integer`', async () => {
    await writeSnapshotFixture(buildSnapshot());
    const h = buildHarness();
    const code = await h.run([], { todo: '0' });
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(h.stderr()).toMatch(/must be a positive integer/);
  });

  it('--todo abc → USAGE_ERROR `must be a positive integer`', async () => {
    await writeSnapshotFixture(buildSnapshot());
    const h = buildHarness();
    const code = await h.run([], { todo: 'abc' });
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(h.stderr()).toMatch(/must be a positive integer/);
  });

  it('--todo 3 + --plan 05 → USAGE_ERROR `--todo and --plan are mutually exclusive`', async () => {
    const h = buildHarness();
    const code = await h.run([], { todo: '3', plan: '05' });
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(h.stderr()).toMatch(/--todo and --plan are mutually exclusive/);
  });

  it('--todo 3 + --execute → USAGE_ERROR `--todo and --execute are mutually exclusive`', async () => {
    const h = buildHarness();
    const code = await h.run([], { todo: '3', execute: true });
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(h.stderr()).toMatch(/--todo and --execute are mutually exclusive/);
  });

  it('--todo 3 + positional `4` → USAGE_ERROR `bare positional integer are mutually exclusive`', async () => {
    await writeSnapshotFixture(buildSnapshot());
    const h = buildHarness();
    const code = await h.run(['4'], { todo: '3' });
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(h.stderr()).toMatch(/bare positional integer are mutually exclusive/);
  });
});

describe('@swt-labs/cli — cookHandler extended-context injection (Plan 15-04-01 T5)', () => {
  it('(ref:HASH) + details with detail + files → trailer carries full extended_context line', async () => {
    await writeDetailsFixture({
      schema_version: 1,
      todos: {
        abc12345: buildDetail({
          detail: 'long context',
          files: ['a.ts', 'b.ts'],
        }),
      },
    });
    const h = buildHarness();
    const code = await h.run(['fix the bug (ref:abc12345)']);
    expect(code).toBe(EXIT.SUCCESS);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- ref_hash: abc12345');
    expect(prompt).toContain(
      '- extended_context: Extended context (from todo detail): long context. Related files: a.ts, b.ts.',
    );
  });

  it('(ref:HASH) + details with empty files → trailer line OMITS `Related files:` clause', async () => {
    await writeDetailsFixture({
      schema_version: 1,
      todos: {
        abc12345: buildDetail({ detail: 'context', files: [] }),
      },
    });
    const h = buildHarness();
    const code = await h.run(['fix (ref:abc12345)']);
    expect(code).toBe(EXIT.SUCCESS);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- extended_context: Extended context (from todo detail): context.');
    expect(prompt).not.toContain('Related files:');
  });

  it('(ref:HASH) + details without `detail` field → trailer does NOT contain extended_context (graceful degradation)', async () => {
    await writeDetailsFixture({
      schema_version: 1,
      todos: {
        abc12345: buildDetail({ files: ['a.ts'] }),
      },
    });
    const h = buildHarness();
    const code = await h.run(['fix (ref:abc12345)']);
    expect(code).toBe(EXIT.SUCCESS);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- ref_hash: abc12345');
    expect(prompt).not.toContain('- extended_context:');
  });

  it('(ref:HASH) + details[hash] absent → trailer omits extended_context + stderr `not found`', async () => {
    // Write an empty details file so the lookup deterministically misses.
    await writeDetailsFixture({ schema_version: 1, todos: {} });
    const h = buildHarness();
    const code = await h.run(['fix (ref:abc12345)']);
    expect(code).toBe(EXIT.SUCCESS);
    const prompt = getSpawnedPrompt(h.spawnImpl);
    expect(prompt).toContain('- ref_hash: abc12345');
    expect(prompt).not.toContain('- extended_context:');
    expect(h.stderr()).toMatch(/\[cook\] ref hash abc12345 not found in todo-details\.json/);
  });
});
