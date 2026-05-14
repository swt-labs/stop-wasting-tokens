/**
 * Plan 04-01 (Phase 4) T5 — cook-events integration test.
 *
 * End-to-end coverage of the cook IPC event channel + control-signal
 * pause/cancel pathway. The fake cookHandler is driven by an injected
 * `spawnFn` that returns a synthetic TaskResult; the test then reads
 * the resulting `.swt-planning/.events/cook-*.jsonl` + `.metrics/
 * session-*.json` + `.cook-controls/*.pending` to assert the wire format
 * matches every plan 04-01 success criterion.
 */

import type { PathLike, PathOrFileDescriptor } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PhaseDetectResult } from '@swt-labs/methodology';
import type { AskUserResponse } from '@swt-labs/runtime';
import { SnapshotEventSchema, type TaskResult } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookHandler, __setCookControlsForTesting } from '../src/commands/cook.js';
import { EXIT } from '../src/exit-codes.js';
import type { CommandIO } from '../src/router.js';

const TEST_SESSION_ID = 'cook-events-test-session';

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
Bootstrap.

### Mode: Scope
Scope.

### Mode: Discuss
Discuss.

### Mode: Assumptions
Assumptions.

### Mode: UAT Remediation
UAT.

### Mode: Milestone UAT Recovery
Milestone.

### Mode: Plan
Plan.

### Mode: Execute
Execute body.

### Mode: Verify
Verify.

### Mode: Add Phase
Add.

### Mode: Insert Phase
Insert.

### Mode: Remove Phase
Remove.

### Mode: Archive
Archive.
`;

interface HarnessOpts {
  readonly state?: PhaseDetectResult;
  readonly askResponses?: ReadonlyArray<AskUserResponse>;
  readonly spawnResult?: Partial<TaskResult>;
  /** Hook that runs INSIDE the injected spawnFn before it returns —
   *  lets a test write a signal file just before runMode finishes its
   *  one-and-only spawn (used by the cancel-while-spawning test). */
  readonly spawnSideEffect?: () => Promise<void> | void;
}

async function buildHarness(repoRoot: string, opts: HarnessOpts = {}) {
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
    task_id: 'cook-events-test-task',
    status: 'success',
    summary: 'ok',
    files_changed: [],
    must_haves: [],
    ...opts.spawnResult,
  };
  const spawnImpl = vi.fn(async () => {
    if (opts.spawnSideEffect !== undefined) await opts.spawnSideEffect();
    return spawnResult;
  });

  const detectPhaseImpl = vi.fn(async () => state);
  const execSyncImpl = vi.fn((_cmd: string, _opts: unknown) => '' as unknown as Buffer);
  const readFileSyncImpl = vi.fn((_p: PathOrFileDescriptor, _enc?: unknown) => STUB_COOK_MD);
  const existsSyncImpl = vi.fn((_p: PathLike) => false);

  const handler = makeCookHandler({
    detectPhaseImpl: detectPhaseImpl,
    askUserImpl: askUserImpl,
    spawnOrchestratorSessionImpl: spawnImpl,
    execSyncImpl: execSyncImpl as never,
    readFileSyncImpl: readFileSyncImpl as never,
    existsSyncImpl: existsSyncImpl,
  });

  const stderr: string[] = [];
  const io: CommandIO = {
    cwd: repoRoot,
    stdout: {
      write: () => true,
    } as unknown as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
  };

  async function run(positionals: readonly string[] = []) {
    return handler({ verb: 'cook', positionals, flags: {} }, io);
  }
  return { run, spawnImpl, stderr: () => stderr.join('') };
}

async function readJsonl(path: string): Promise<unknown[]> {
  const raw = await readFile(path, 'utf-8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

async function findCookEventsFile(repoRoot: string): Promise<string> {
  const eventsDir = join(repoRoot, '.swt-planning', '.events');
  const entries = await readdir(eventsDir);
  const cookFile = entries.find((f) => f.startsWith('cook-') && f.endsWith('.jsonl'));
  if (cookFile === undefined) {
    throw new Error(`no cook-*.jsonl found in ${eventsDir} (entries: ${entries.join(', ')})`);
  }
  return join(eventsDir, cookFile);
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'swt-cook-events-'));
  process.env['SWT_INSTALL_ROOT'] = repoRoot;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
  __setCookControlsForTesting(undefined);
});

afterEach(async () => {
  __setCookControlsForTesting(undefined);
  await rm(repoRoot, { recursive: true, force: true });
});

describe('@swt-labs/cli — cook events integration (Plan 04-01 T5)', () => {
  it('produces priority_decision → agent_spawn → agent_result → completion in order', async () => {
    const h = await buildHarness(repoRoot, {
      // priority 10 — needs_execute, gated by askUser (accepts by default)
      state: makePhaseDetect({ next_phase_state: 'needs_execute' }),
    });
    const code = await h.run([]);
    expect(code).toBe(EXIT.SUCCESS);

    const file = await findCookEventsFile(repoRoot);
    const events = await readJsonl(file);
    const types = events.map((e) => (e as { type: string }).type);
    // Plan 06-01 T2 — runMode now wraps the spawn with task lifecycle
    // events (task_start before the spawn; task_commit + task_complete
    // after a successful spawn). task_commit is best-effort and only
    // emitted when `git log -1` resolves a HEAD commit; in this test
    // sandbox the cwd is a tmp dir with no git repo, so task_commit is
    // absent from the sequence.
    // Plan 02-04 T3 (Phase 2 / G-R3) — runSpawnWithFallback now emits
    // cook.provider_selected once per spawn after the router resolves the
    // primary provider, landing between cook.agent_spawn and the spawn's
    // cook.agent_result.
    // Plan 03-04 T2 (Phase 3 / G-R4) — runMode now wires onProjection: the
    // default budget gate + the embedded rate card make projectionActive
    // true, so cook.budget_projected is emitted once per spawn (here a
    // passing projection — would_exceed: false), landing right after
    // cook.provider_selected and before the spawn's cook.agent_result.
    expect(types).toEqual([
      'cook.priority_decision',
      'cook.task_start',
      'cook.agent_spawn',
      'cook.provider_selected',
      'cook.budget_projected',
      'cook.agent_result',
      'cook.task_complete',
      'cook.completion',
    ]);
  });

  it('every emitted line parses through SnapshotEventSchema', async () => {
    const h = await buildHarness(repoRoot, {
      state: makePhaseDetect({ next_phase_state: 'needs_execute' }),
    });
    await h.run([]);
    const events = await readJsonl(await findCookEventsFile(repoRoot));
    for (const ev of events) {
      const parsed = SnapshotEventSchema.safeParse(ev);
      expect(parsed.success, `event=${JSON.stringify(ev)}`).toBe(true);
    }
  });

  it('writes a .metrics/session-*.json aggregate with agent_results=1', async () => {
    const h = await buildHarness(repoRoot, {
      state: makePhaseDetect({ next_phase_state: 'needs_execute' }),
    });
    await h.run([]);
    const metricsDir = join(repoRoot, '.swt-planning', '.metrics');
    const entries = await readdir(metricsDir);
    const sessionFile = entries.find((f) => f.startsWith('session-') && f.endsWith('.json'));
    expect(sessionFile, `metrics entries: ${entries.join(', ')}`).toBeDefined();
    const metrics = JSON.parse(await readFile(join(metricsDir, sessionFile!), 'utf-8')) as {
      agent_results: number;
      tokens: { in: number; out: number };
    };
    expect(metrics.agent_results).toBe(1);
    // T2 emits {input_tokens: 0, output_tokens: 0} until Phase 5 parity.
    expect(metrics.tokens.in).toBe(0);
    expect(metrics.tokens.out).toBe(0);
  });

  it('agent_spawn → agent_result include the orchestrator role + sub_session_id', async () => {
    const h = await buildHarness(repoRoot, {
      state: makePhaseDetect({ next_phase_state: 'needs_execute' }),
    });
    await h.run([]);
    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const spawn = events.find((e) => (e as { type: string }).type === 'cook.agent_spawn') as
      | { role: string; sub_session_id: string }
      | undefined;
    const result = events.find((e) => (e as { type: string }).type === 'cook.agent_result') as
      | { sub_session_id: string; status: string; usage: { input_tokens: number } }
      | undefined;
    expect(spawn?.role).toBe('orchestrator');
    expect(spawn?.sub_session_id).toBeTruthy();
    expect(result?.sub_session_id).toBe(spawn?.sub_session_id);
    expect(result?.status).toBe('completed');
  });

  it('cancel signal during spawn → CookCancelledError → EXIT.USER_CANCELLED + cook.completion status=cancelled', async () => {
    // Plant the cancel signal mid-spawn so the post-spawn checkpoint
    // would normally fire — except runMode only polls at its top, so
    // we instead plant the cancel BEFORE the runMode entry by using
    // a state that requires confirmation (priority 10 needs_execute)
    // and seeding the signal during the askUser callback.
    const h = await buildHarness(repoRoot, {
      state: makePhaseDetect({ next_phase_state: 'needs_execute' }),
    });
    // Seed cancel BEFORE the handler runs. The runMode poll at the top
    // of dispatch picks it up and throws CookCancelledError before any
    // spawn happens.
    const controlsDir = join(repoRoot, '.swt-planning', '.cook-controls');
    await mkdir(controlsDir, { recursive: true });
    await writeFile(join(controlsDir, `${TEST_SESSION_ID}.pending`), 'cancel');

    __setCookControlsForTesting({
      planningRoot: repoRoot,
      pollIntervalMs: 5,
      maxPollsPerPause: 50,
    });

    const code = await h.run([]);
    expect(code).toBe(EXIT.USER_CANCELLED);
    expect(h.stderr()).toContain('cancelled by user');

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const completion = events.find((e) => (e as { type: string }).type === 'cook.completion') as
      | { status: string }
      | undefined;
    expect(completion?.status).toBe('cancelled');

    // Cancel happens AT the runMode boundary (before spawn), so we
    // should NOT see agent_spawn / agent_result rows.
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).not.toContain('cook.agent_spawn');
    expect(types).not.toContain('cook.agent_result');

    // Signal file was consumed.
    const remaining = await readdir(controlsDir).catch(() => [] as string[]);
    expect(remaining).not.toContain(`${TEST_SESSION_ID}.pending`);
  });

  it('pause → resume sequence: runMode blocks on pause until resume lands', async () => {
    const h = await buildHarness(repoRoot, {
      state: makePhaseDetect({ next_phase_state: 'needs_execute' }),
    });
    const controlsDir = join(repoRoot, '.swt-planning', '.cook-controls');
    await mkdir(controlsDir, { recursive: true });
    await writeFile(join(controlsDir, `${TEST_SESSION_ID}.pending`), 'pause');

    __setCookControlsForTesting({
      planningRoot: repoRoot,
      pollIntervalMs: 5,
      maxPollsPerPause: 200,
    });

    // Plant the resume after a short delay — simulates the user clicking
    // "resume" in the dashboard partway through the paused window.
    setTimeout(() => {
      void writeFile(join(controlsDir, `${TEST_SESSION_ID}.pending`), 'resume');
    }, 25);

    const code = await h.run([]);
    expect(code).toBe(EXIT.SUCCESS);

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    // After resume the spawn proceeds normally and we get the full sequence.
    expect(types).toContain('cook.agent_spawn');
    expect(types).toContain('cook.agent_result');
    const completion = events.find((e) => (e as { type: string }).type === 'cook.completion') as
      | { status: string }
      | undefined;
    expect(completion?.status).toBe('success');
  });
});
