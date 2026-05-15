/**
 * Plan 01-01 Phase 01 T3 — Regression coverage for the CLI positional →
 * seed-file write contract.
 *
 * The handler must write `argsAfterTodo` to
 * `.swt-planning/.pending-scope-idea.txt` ONLY when the resolved CookMode
 * is `scope`. Bare phase-number, ref-tag, flag-only, NL-routed Execute,
 * and whitespace-only positionals must NOT trigger a write. A prior
 * non-empty seed file is overwritten newer-wins with a stderr length-only
 * notice.
 *
 * Test harness mirrors `cook.test.ts` (Plan 03-02 T5):
 *   - Fake REPO_ROOT — no real filesystem.
 *   - detectPhaseImpl / askUserImpl / spawnOrchestratorSessionImpl /
 *     execSyncImpl / readFileSyncImpl / existsSyncImpl / writeFileSyncImpl
 *     all injected as vi.fn().
 *   - STUB_COOK_MD provides every `### Mode: …` heading the routing
 *     table targets so `extractModeSection` always finds its slice.
 */

import type { execSync as ExecSyncFn } from 'node:child_process';
import type { PathLike, PathOrFileDescriptor } from 'node:fs';

import type { PhaseDetectResult } from '@swt-labs/methodology';
import type { AskUserResponse } from '@swt-labs/runtime';
import type { TaskResult } from '@swt-labs/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeCookHandler } from '../../src/commands/cook.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-cook-seed-positional-test-repo';
const TEST_SESSION_ID = 'cook-seed-positional-session';
const SEED_PATH_SUFFIX = '/.swt-planning/.pending-scope-idea.txt';

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

interface HarnessOpts {
  readonly state?: PhaseDetectResult;
  readonly askResponses?: ReadonlyArray<AskUserResponse>;
  /** When set, existsSync(seedPath) returns true and readFileSync(seedPath)
   * returns this string — exercises the newer-wins overwrite path. */
  readonly priorSeedContent?: string;
}

function buildHarness(opts: HarnessOpts = {}) {
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
    task_id: 'cook-seed-test-task',
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

  const readFileSyncImpl = vi.fn((p: PathOrFileDescriptor, _enc?: unknown) => {
    if (opts.priorSeedContent !== undefined && String(p).endsWith(SEED_PATH_SUFFIX)) {
      return opts.priorSeedContent;
    }
    return STUB_COOK_MD;
  });

  const existsSyncImpl = vi.fn((p: PathLike) => {
    if (opts.priorSeedContent !== undefined && String(p).endsWith(SEED_PATH_SUFFIX)) {
      return true;
    }
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
    writeFileSyncImpl: writeFileSyncImpl as never,
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
    return handler({ verb: 'cook', positionals, flags }, io);
  }

  return {
    run,
    spawnImpl,
    askUserImpl,
    writeFileSyncImpl,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

describe('@swt-labs/cli — cookHandler positional → seed-file write (Plan 01-01 T3)', () => {
  it('writes seed to .swt-planning/.pending-scope-idea.txt on greenfield Scope route', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ phase_count: 0, next_phase_state: 'phase_count_zero' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    const exitCode = await h.run(['snake game']);
    expect(exitCode).toBe(0);

    // Exactly one seed write, at the expected absolute path, with the
    // trimmed positional text and utf8 encoding.
    expect(h.writeFileSyncImpl).toHaveBeenCalledTimes(1);
    const writeArgs = h.writeFileSyncImpl.mock.calls[0];
    expect(String(writeArgs?.[0])).toBe(`${REPO_ROOT}${SEED_PATH_SUFFIX}`);
    expect(writeArgs?.[1]).toBe('snake game');
    expect(writeArgs?.[2]).toBe('utf8');

    // The handler reached Scope mode and spawned the orchestrator.
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Scope');
  });

  it('writes seed and emits stderr overwrite-notice when a prior non-empty seed exists', async () => {
    const priorSeed = 'stale prior idea'; // 16 chars
    const h = buildHarness({
      state: makePhaseDetect({ phase_count: 0, next_phase_state: 'phase_count_zero' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
      priorSeedContent: priorSeed,
    });
    await h.run(['snake game']);

    expect(h.writeFileSyncImpl).toHaveBeenCalledTimes(1);
    expect(h.writeFileSyncImpl.mock.calls[0]?.[1]).toBe('snake game');

    expect(h.stderr()).toMatch(
      /\[cook\] seed-file overwritten from CLI positional \(was 16 chars\)/,
    );
  });

  it('does NOT write seed on NL-routed Execute (edge case A — keyword "build")', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ phase_count: 0, next_phase_state: 'phase_count_zero' }),
      // The NL routing fires its OWN askUser ("Interpreted as Execute. Proceed?")
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run(['build a snake game']);

    expect(h.writeFileSyncImpl).not.toHaveBeenCalled();
    // The NL keyword "build" routes to Execute, not Scope.
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Execute');
  });

  it('does NOT write seed on bare phase-number positional (phaseTarget set)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ phase_count: 0, next_phase_state: 'phase_count_zero' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    // `swt cook 3` — resolveTodoNumber sets phaseTarget=3.
    await h.run(['3']);
    expect(h.writeFileSyncImpl).not.toHaveBeenCalled();
  });

  it('does NOT write seed on ref-tag positional (refHash set)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ phase_count: 0, next_phase_state: 'phase_count_zero' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    // `swt cook "do this (ref:abcd1234)"` — extractRefTag matches
    // \s*\(ref:HEX{8}\) and sets refHash; the remaining "do this" still
    // has non-empty trim, so the refHash guard (not the empty-arg guard)
    // is the one that blocks the seed write.
    await h.run(['do this (ref:abcd1234)']);
    expect(h.writeFileSyncImpl).not.toHaveBeenCalled();
  });

  it('does NOT write seed on flag-only invocation (no positional)', async () => {
    const h = buildHarness({
      state: makePhaseDetect(),
    });
    // `swt cook --scope` — flag forces Scope, but argsAfterTodo is empty.
    await h.run([], { scope: true });
    expect(h.writeFileSyncImpl).not.toHaveBeenCalled();
  });

  it('does NOT write seed on whitespace-only positional', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ phase_count: 0, next_phase_state: 'phase_count_zero' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    // Three spaces → trim → empty.
    await h.run(['   ']);
    expect(h.writeFileSyncImpl).not.toHaveBeenCalled();
  });
});
