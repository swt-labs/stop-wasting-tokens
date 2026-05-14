/**
 * Plan 06-02 T4 (REQ-16) — BudgetGate wired into the cook task loop.
 *
 * Coverage:
 *   (a) Gate state === 'ok' (under budget) → cook proceeds normally,
 *       spawn fires, no budget_exceeded event emitted.
 *   (b) Gate state === 'paused' on entry → cook refuses to spawn, emits
 *       cook.budget_exceeded(reason='paused_on_entry') + task_fail +
 *       completion(status='failed'). Spawn is NOT invoked.
 *   (c) Gate transitions to 'paused' during spawn (subscriber callback) →
 *       cook.budget_exceeded(reason='paused_during_spawn') lands on the
 *       events JSONL. Spawn still completes (we don't preempt mid-turn
 *       per research §4.6 deferral).
 *   (d) After a bumpCeiling → gate emits budget.resume → cook emits
 *       cook.budget_resume on the JSONL.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PhaseDetectResult } from '@swt-labs/methodology';
import type { AskUserResponse } from '@swt-labs/runtime';
import {
  SnapshotEventSchema,
  type BudgetConfigSchemaT,
  type TaskResult,
} from '@swt-labs/shared';
import type {
  BudgetEvent,
  BudgetGate,
  BudgetGateState,
  BudgetProjectionResult,
  CostProjection,
} from '@swt-labs/runtime';

import {
  makeCookHandler,
  __setCookControlsForTesting,
  type BudgetGateFactory,
} from '../../src/commands/cook.js';
import { EXIT } from '../../src/exit-codes.js';
import type { CommandIO } from '../../src/router.js';

const TEST_SESSION_ID = 'cook-budget-test-session';

const STUB_BUDGET_CONFIG: BudgetConfigSchemaT = {
  schema_version: 1,
  milestone_usd: 10,
  tier_downgrade_threshold: 0.7,
  pause_threshold: 0.95,
};

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

/**
 * Fake BudgetGate — exposes setState() so tests can flip the gate's
 * status before runMode reads it, plus emit() so tests can fire transition
 * events from inside the spawn callback. Plan 03-04: setProjectionResult()
 * lets a test pin what gate.project(...) returns so the runMode onProjection
 * wiring can be driven into the would_exceed halt path.
 */
interface FakeGate extends BudgetGate {
  setState(s: Partial<BudgetGateState>): void;
  emit(ev: BudgetEvent): void;
  /** Plan 03-04 — pin the result of project() (default: would_exceed false). */
  setProjectionResult(fn: (projection: CostProjection) => BudgetProjectionResult): void;
}

function makeFakeGate(initial: Partial<BudgetGateState> = {}): FakeGate {
  let currentState: BudgetGateState = {
    spent_usd: 0,
    ceiling_usd: STUB_BUDGET_CONFIG.milestone_usd,
    pressure: 0,
    status: 'ok',
    ...initial,
  };
  const listeners: Array<(ev: BudgetEvent) => void> = [];
  // Plan 03-04 — default project() impl: a passing projection (would_exceed
  // false) with an honest projected_pressure. Tests override via
  // setProjectionResult() to drive the halt path.
  let projectImpl: (projection: CostProjection) => BudgetProjectionResult = (
    projection,
  ) => {
    const projectedSpent = currentState.spent_usd + projection.projected_cost_usd;
    const projected_pressure =
      currentState.ceiling_usd > 0 ? projectedSpent / currentState.ceiling_usd : 0;
    return { would_exceed: false, projected_pressure, projection };
  };
  return {
    state: () => currentState,
    subscribe: (l) => {
      listeners.push(l);
      return () => {
        const idx = listeners.indexOf(l);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    bumpCeiling: (delta) => {
      currentState = {
        ...currentState,
        ceiling_usd: currentState.ceiling_usd + delta,
        pressure: currentState.spent_usd / (currentState.ceiling_usd + delta),
      };
    },
    project: (projection) => projectImpl(projection),
    dispose: () => {
      listeners.length = 0;
    },
    setState(s) {
      currentState = { ...currentState, ...s };
    },
    emit(ev) {
      for (const l of [...listeners]) l(ev);
    },
    setProjectionResult(fn) {
      projectImpl = fn;
    },
  };
}

interface HarnessOpts {
  readonly gate?: FakeGate;
  readonly factory?: BudgetGateFactory;
  /** Hook that runs inside spawn — can emit on the gate to test in-flight transitions. */
  readonly spawnSideEffect?: (gate: FakeGate | undefined) => Promise<void> | void;
  readonly spawnResult?: Partial<TaskResult>;
  /**
   * Plan 03-04 — when set, the harness routes `.swt-planning/config.json`
   * reads to this JSON object (existsSync → true for that path, readFileSync
   * → the stringified object). Lets a test exercise the
   * `budget.projection_enabled: false` config path through loadCookConfig.
   */
  readonly configJson?: Record<string, unknown>;
}

async function buildHarness(repoRoot: string, opts: HarnessOpts = {}) {
  const askUserImpl = vi.fn(
    async () => ({ selectedOption: 'Yes', freeform: null } as AskUserResponse),
  );

  const spawnResult: TaskResult = {
    schema_version: 1,
    task_id: 'cook-budget-test-task',
    status: 'success',
    summary: 'ok',
    files_changed: [],
    must_haves: [],
    ...opts.spawnResult,
  };
  const spawnImpl = vi.fn(async () => {
    if (opts.spawnSideEffect !== undefined) await opts.spawnSideEffect(opts.gate);
    return spawnResult;
  });

  const detectPhaseImpl = vi.fn(async () => makePhaseDetect({ next_phase_state: 'needs_execute' }));
  const execSyncImpl = vi.fn((_cmd: string, _opts: unknown) => '' as unknown as Buffer);
  // Plan 03-04 — config.json routing. When opts.configJson is set, the
  // injected fs impls report the config path as present and return its
  // JSON; all other reads still resolve to STUB_COOK_MD.
  const configPathSuffix = join('.swt-planning', 'config.json');
  const readFileSyncImpl = vi.fn((p?: unknown) => {
    if (
      opts.configJson !== undefined &&
      typeof p === 'string' &&
      p.endsWith(configPathSuffix)
    ) {
      return JSON.stringify(opts.configJson);
    }
    return STUB_COOK_MD;
  });
  const existsSyncImpl = vi.fn((p?: unknown) => {
    if (
      opts.configJson !== undefined &&
      typeof p === 'string' &&
      p.endsWith(configPathSuffix)
    ) {
      return true;
    }
    return false;
  });

  // Resolve the factory: explicit factory > gate seed > no-op (gate disabled).
  const factory: BudgetGateFactory =
    opts.factory ??
    (opts.gate !== undefined
      ? () => ({ gate: opts.gate as BudgetGate })
      : () => null);

  const handler = makeCookHandler({
    detectPhaseImpl: detectPhaseImpl as never,
    askUserImpl: askUserImpl as never,
    spawnOrchestratorSessionImpl: spawnImpl as never,
    execSyncImpl: execSyncImpl as never,
    readFileSyncImpl: readFileSyncImpl as never,
    existsSyncImpl: existsSyncImpl as never,
    budgetGateFactory: factory,
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
  repoRoot = await mkdtemp(join(tmpdir(), 'swt-cook-budget-'));
  process.env['SWT_INSTALL_ROOT'] = repoRoot;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
  __setCookControlsForTesting(undefined);
});

afterEach(async () => {
  __setCookControlsForTesting(undefined);
  await rm(repoRoot, { recursive: true, force: true });
});

describe('Plan 06-02 T4 — BudgetGate wired into cook task loop', () => {
  it('(a) gate state === ok → spawn proceeds; no budget_exceeded emitted', async () => {
    const gate = makeFakeGate({ status: 'ok', spent_usd: 1.0 });
    const h = await buildHarness(repoRoot, { gate });

    const code = await h.run([]);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('cook.agent_spawn');
    expect(types).toContain('cook.agent_result');
    expect(types).not.toContain('cook.budget_exceeded');
    expect(types).not.toContain('cook.budget_resume');
  });

  it('(b) gate state === paused on entry → no spawn; budget_exceeded(paused_on_entry) emitted', async () => {
    const gate = makeFakeGate({
      status: 'paused',
      spent_usd: 9.6,
      ceiling_usd: 10,
      pressure: 0.96,
    });
    const h = await buildHarness(repoRoot, { gate });

    const code = await h.run([]);
    expect(code).toBe(EXIT.RUNTIME_ERROR);
    expect(h.spawnImpl).not.toHaveBeenCalled();

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('cook.budget_exceeded');
    expect(types).toContain('cook.task_fail');
    expect(types).toContain('cook.completion');
    expect(types).not.toContain('cook.agent_spawn');

    const exceeded = events.find(
      (e) => (e as { type: string }).type === 'cook.budget_exceeded',
    ) as
      | { reason: string; spent_usd: number; ceiling_usd: number; threshold: number }
      | undefined;
    expect(exceeded?.reason).toBe('paused_on_entry');
    expect(exceeded?.spent_usd).toBe(9.6);
    expect(exceeded?.ceiling_usd).toBe(10);
    expect(exceeded?.threshold).toBe(0.95);

    expect(h.stderr()).toContain('milestone budget is paused');
  });

  it('(c) gate transitions to paused during spawn → budget_exceeded(paused_during_spawn) emitted', async () => {
    const gate = makeFakeGate({ status: 'ok' });
    const h = await buildHarness(repoRoot, {
      gate,
      spawnSideEffect: async (g) => {
        // Simulate a daughter session blowing through the pause threshold
        // while the spawn is still running. The gate's subscriber should
        // be called via the runMode's gate.subscribe wiring.
        g?.emit({
          type: 'budget.pause',
          ts: '2026-05-13T12:00:00.000Z',
          spent_usd: 9.7,
          ceiling_usd: 10,
          threshold: 0.95,
        });
      },
    });

    const code = await h.run([]);
    // Spawn returns success (we don't preempt mid-turn per research §4.6),
    // so cook completes successfully. The budget_exceeded event is still
    // on the JSONL for the dashboard to react to on the next turn.
    expect(code).toBe(EXIT.SUCCESS);

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('cook.agent_spawn');
    expect(types).toContain('cook.budget_exceeded');

    const exceeded = events.find(
      (e) => (e as { type: string }).type === 'cook.budget_exceeded',
    ) as
      | { reason: string; spent_usd: number; ceiling_usd: number; threshold: number }
      | undefined;
    expect(exceeded?.reason).toBe('paused_during_spawn');
    expect(exceeded?.spent_usd).toBe(9.7);
  });

  it('(d) gate emits budget.resume after bumpCeiling → cook.budget_resume on JSONL', async () => {
    const gate = makeFakeGate({ status: 'ok' });
    const h = await buildHarness(repoRoot, {
      gate,
      spawnSideEffect: async (g) => {
        // First fire pause (transition during spawn), then user manually
        // bumps the ceiling and the gate fires resume.
        g?.emit({
          type: 'budget.pause',
          ts: '2026-05-13T12:00:00.000Z',
          spent_usd: 9.6,
          ceiling_usd: 10,
          threshold: 0.95,
        });
        g?.emit({
          type: 'budget.resume',
          ts: '2026-05-13T12:00:05.000Z',
          spent_usd: 9.6,
          ceiling_usd: 20,
        });
      },
    });

    const code = await h.run([]);
    expect(code).toBe(EXIT.SUCCESS);

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('cook.budget_exceeded');
    expect(types).toContain('cook.budget_resume');

    const resume = events.find(
      (e) => (e as { type: string }).type === 'cook.budget_resume',
    ) as { spent_usd: number; ceiling_usd: number } | undefined;
    expect(resume?.spent_usd).toBe(9.6);
    expect(resume?.ceiling_usd).toBe(20);
  });

  it('all budget events parse through SnapshotEventSchema', async () => {
    const gate = makeFakeGate({ status: 'ok' });
    const h = await buildHarness(repoRoot, {
      gate,
      spawnSideEffect: async (g) => {
        g?.emit({
          type: 'budget.pause',
          ts: '2026-05-13T12:00:00.000Z',
          spent_usd: 9.6,
          ceiling_usd: 10,
          threshold: 0.95,
        });
        g?.emit({
          type: 'budget.resume',
          ts: '2026-05-13T12:00:05.000Z',
          spent_usd: 9.6,
          ceiling_usd: 20,
        });
      },
    });
    await h.run([]);
    const events = await readJsonl(await findCookEventsFile(repoRoot));
    for (const ev of events) {
      const parsed = SnapshotEventSchema.safeParse(ev);
      expect(parsed.success, `event=${JSON.stringify(ev)}`).toBe(true);
    }
  });

  it('factory returning null → gate disabled; no budget events emitted', async () => {
    // No factory wiring + no gate fixture → factory returns null
    const h = await buildHarness(repoRoot, { factory: () => null });
    const code = await h.run([]);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).not.toContain('cook.budget_exceeded');
    expect(types).not.toContain('cook.budget_resume');
  });

  it('paused-on-entry path disposes the gate handle (cleanup)', async () => {
    const gate = makeFakeGate({
      status: 'paused',
      spent_usd: 9.6,
      ceiling_usd: 10,
    });
    const dispose = vi.fn(async () => undefined);
    const h = await buildHarness(repoRoot, {
      factory: () => ({ gate, dispose }),
    });
    await h.run([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('happy path disposes the gate handle in finally', async () => {
    const gate = makeFakeGate({ status: 'ok' });
    const dispose = vi.fn(async () => undefined);
    const h = await buildHarness(repoRoot, {
      factory: () => ({ gate, dispose }),
    });
    await h.run([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('Plan 03-04 T4 (G-R4) — runMode pre-spawn projection wiring', () => {
  it('(1) projection_enabled: false → no projection path, spawn proceeds, no cook.budget_projected', async () => {
    // A gate exists and a rate card would load, but config opts out — the
    // onProjection handler must NOT be wired.
    const gate = makeFakeGate({ status: 'ok', spent_usd: 1.0 });
    const h = await buildHarness(repoRoot, {
      gate,
      configJson: {
        budget: {
          schema_version: 1,
          milestone_usd: 10,
          tier_downgrade_threshold: 0.7,
          pause_threshold: 0.95,
          projection_enabled: false,
        },
      },
    });

    const code = await h.run([]);
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('cook.agent_spawn');
    expect(types).toContain('cook.agent_result');
    // projection disabled → the forecast event is never emitted.
    expect(types).not.toContain('cook.budget_projected');
  });

  it('(2) rate-card load failure → projection skipped, spawn proceeds, turn does not fail', async () => {
    // A malformed project rate card makes createRateCardSource(...) throw on
    // construction. The best-effort load swallows it → rateCard undefined →
    // onProjection is left unwired → the spawn proceeds, the turn succeeds.
    await mkdir(join(repoRoot, '.swt-planning'), { recursive: true });
    await writeFile(
      join(repoRoot, '.swt-planning', 'rate-card.json'),
      '{ this is not valid json',
      'utf8',
    );

    const gate = makeFakeGate({ status: 'ok', spent_usd: 1.0 });
    const h = await buildHarness(repoRoot, { gate });

    const code = await h.run([]);
    // The cook turn does NOT fail — the projection path degraded gracefully.
    expect(code).toBe(EXIT.SUCCESS);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('cook.agent_spawn');
    // rate card failed to load → no projection → no forecast event.
    expect(types).not.toContain('cook.budget_projected');
  });

  it('(3) projection would_exceed → cook turn fails pre-spawn with the right events + exit code', async () => {
    // The gate's project() is pinned to would_exceed: true. The runMode
    // onProjection handler emits cook.budget_projected(would_exceed:true),
    // returns the result; runSpawnWithFallback throws
    // BudgetProjectionExceededError; the catch branch emits cook.task_fail +
    // cook.completion(failed) and returns EXIT.RUNTIME_ERROR. spawnFn is
    // never invoked — no money spent.
    const gate = makeFakeGate({ status: 'ok', spent_usd: 9.0, ceiling_usd: 10 });
    gate.setProjectionResult((projection: CostProjection) => ({
      would_exceed: true,
      projected_pressure: 1.4,
      projection,
    }));
    const h = await buildHarness(repoRoot, { gate });

    const code = await h.run([]);
    expect(code).toBe(EXIT.RUNTIME_ERROR);
    // No spawn ran — the halt is pre-emptive.
    expect(h.spawnImpl).not.toHaveBeenCalled();

    const events = await readJsonl(await findCookEventsFile(repoRoot));
    const types = events.map((e) => (e as { type: string }).type);

    // The forecast event fired BEFORE the halt — would_exceed: true.
    expect(types).toContain('cook.budget_projected');
    const projected = events.find(
      (e) => (e as { type: string }).type === 'cook.budget_projected',
    ) as { would_exceed: boolean; projected_pressure: number } | undefined;
    expect(projected?.would_exceed).toBe(true);
    expect(projected?.projected_pressure).toBe(1.4);

    // Followed by the failure events mirroring the paused_on_entry shape.
    expect(types).toContain('cook.task_fail');
    expect(types).toContain('cook.completion');
    const taskFail = events.find(
      (e) => (e as { type: string }).type === 'cook.task_fail',
    ) as { reason: string } | undefined;
    expect(taskFail?.reason).toBe('budget_projection_exceeded');
    const completion = events.find(
      (e) => (e as { type: string }).type === 'cook.completion',
    ) as { status: string } | undefined;
    expect(completion?.status).toBe('failed');

    // Event ordering: cook.budget_projected lands before cook.task_fail.
    expect(types.indexOf('cook.budget_projected')).toBeLessThan(
      types.indexOf('cook.task_fail'),
    );

    // All emitted events still parse through the canonical schema.
    for (const ev of events) {
      const parsed = SnapshotEventSchema.safeParse(ev);
      expect(parsed.success, `event=${JSON.stringify(ev)}`).toBe(true);
    }
  });

  it('(3b) would_exceed halt still disposes the gate handle (cleanup)', async () => {
    const gate = makeFakeGate({ status: 'ok', spent_usd: 9.0, ceiling_usd: 10 });
    gate.setProjectionResult((projection: CostProjection) => ({
      would_exceed: true,
      projected_pressure: 1.4,
      projection,
    }));
    const dispose = vi.fn(async () => undefined);
    const h = await buildHarness(repoRoot, {
      factory: () => ({ gate, dispose }),
    });
    const code = await h.run([]);
    expect(code).toBe(EXIT.RUNTIME_ERROR);
    // The shared finally disposes the gate even on the projection-halt path.
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
