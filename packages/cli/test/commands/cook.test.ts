/**
 * Plan 03-02 (Phase 3) Task 5 — swt cook handler coverage.
 *
 * Coverage targets:
 *   D.0  — Pre-parse: ref tag extraction strips trailing `(ref:XXXXXXXX)`.
 *   D.0' — Pre-parse: bare integer args resolve to a phase target.
 *   D.1  — Each of the 11 priorities (+ priority 3.5) routes to the
 *          expected `commands/cook.md` mode section.
 *   D.2  — `planning_dir_exists=false` short-circuits to stderr + EXIT.SUCCESS
 *          (no spawn).
 *   D.3  — Path 1 flag detection (--plan) skips confirmation + routes to
 *          Plan mode.
 *   D.4  — Path 2 NL routing enters askUser confirmation; accept → spawn,
 *          reject → no spawn.
 *   D.5  — Confirmation gate (priority 2 Bootstrap) — reject = no spawn,
 *          accept = spawn.
 *   D.6  — Priority 4 (needs_reverification) invokes prepare-reverification.sh
 *          inline; non-zero exit surfaces EXIT.RUNTIME_ERROR.
 *   D.7  — QA gate (priority 7): each top-level decision kind covered.
 *   D.8  — Fallback patterns: all_done + qa-attention pending → verify,
 *          NOT archive.
 *   D.9  — Override flag effect: qa_gate_known_issues_override → proceed_to_uat.
 *   D.10 — auto_uat=true skips confirmation on priority 3 + 3.5 + 4.
 *
 * Mocking strategy:
 *   - detectPhase: injected via `detectPhaseImpl` returning a fixture.
 *   - askUser: injected via `askUserImpl` — deterministic.
 *   - spawnOrchestratorSession: injected via `spawnOrchestratorSessionImpl`
 *     — captures call args; returns a synthetic success TaskResult.
 *   - execSync: injected for the priority-4 prepare-reverification.sh call.
 *   - readFileSync: injected for the cook.md body read — returns a fixture
 *     containing every `### Mode: …` heading the routing table targets.
 *
 * The recording session factory pattern mirrors `spawn-agent.test.ts` —
 * tests assert on captured args + injected return values.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PhaseDetectResult } from '@swt-labs/methodology';
import type { AskUserResponse } from '@swt-labs/runtime';
import type { TaskResult } from '@swt-labs/shared';

import {
  evaluateQaGate,
  extractRefTag,
  makeCookHandler,
  resolveTodoNumber,
  type CookConfig,
} from '../../src/commands/cook.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-cook-test-repo';
const TEST_SESSION_ID = 'cook-test-session-id';

/**
 * Build a phase-detect fixture that defaults to the most "no-op" state
 * possible (planning exists, project exists, no phases). Overrides let
 * each test tilt the fixture into a specific routing-table cell.
 */
function makePhaseDetect(
  overrides: Partial<PhaseDetectResult> = {},
): PhaseDetectResult {
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

/**
 * Stub `commands/cook.md` body — contains every `### Mode: …` heading the
 * routing table targets so `extractModeSection` always finds its slice.
 */
const STUB_COOK_MD = `---
name: swt:cook
---

# SWT Cook

## Some preamble

### Mode: Bootstrap

Bootstrap mode body.

### Mode: Scope

Scope mode body.

### Mode: Discuss

Discuss mode body.

### Mode: Assumptions

Assumptions mode body.

### Mode: UAT Remediation

UAT Remediation mode body.

### Mode: Milestone UAT Recovery

Milestone UAT Recovery body.

### Mode: Plan

Plan mode body.

### Mode: Execute

Execute mode body.

### Mode: Verify

Verify mode body.

### Mode: Add Phase

Add Phase body.

### Mode: Insert Phase

Insert Phase body.

### Mode: Remove Phase

Remove Phase body.

### Mode: Archive

Archive mode body.
`;

/**
 * Build the per-test mock harness. Returns:
 *  - the handler under test
 *  - the spawn / askUser / execSync mocks for assertion
 *  - a runner that drives the handler with a positional/flag mix
 */
interface HarnessOpts {
  readonly state?: PhaseDetectResult;
  readonly askResponses?: ReadonlyArray<AskUserResponse>;
  readonly autoUat?: boolean;
  readonly configOverrides?: Partial<CookConfig>;
  readonly spawnResult?: Partial<TaskResult>;
  readonly execSyncImpl?: typeof import('node:child_process').execSync;
}

function buildHarness(opts: HarnessOpts = {}) {
  const state = opts.state ?? makePhaseDetect();
  const askResponses = opts.askResponses ?? [];
  let askIdx = 0;
  const askUserImpl = vi.fn(async () => {
    const r = askResponses[askIdx];
    askIdx += 1;
    if (r !== undefined) return r;
    return { selectedOption: 'Yes', freeform: null } as AskUserResponse;
  });

  const spawnResult: TaskResult = {
    schema_version: 1,
    task_id: 'cook-test-task',
    status: 'success',
    summary: 'ok',
    files_changed: [],
    must_haves: [],
    ...opts.spawnResult,
  };
  const spawnImpl = vi.fn(async () => spawnResult);

  const detectPhaseImpl = vi.fn(async () => state);

  const execSyncImpl = vi.fn(opts.execSyncImpl ?? ((_cmd: string, _opts: unknown) => '' as unknown as Buffer));

  const readFileSyncImpl = vi.fn(
    (_p: import('node:fs').PathOrFileDescriptor, _enc?: unknown) => STUB_COOK_MD,
  );
  const existsSyncImpl = vi.fn((_p: import('node:fs').PathLike) => {
    // The config.json existsSync check — return false so loadCookConfig
    // returns its default (auto_uat: false, no overrides). Tests that want
    // a richer config pass `configOverrides` and we monkey-patch via
    // a separate fake (see below).
    return false;
  });

  const handler = makeCookHandler({
    detectPhaseImpl: detectPhaseImpl as never,
    askUserImpl: askUserImpl as never,
    spawnOrchestratorSessionImpl: spawnImpl as never,
    execSyncImpl: execSyncImpl as never,
    readFileSyncImpl: readFileSyncImpl as never,
    existsSyncImpl: existsSyncImpl as never,
  });

  // For tests that need a non-default config, the harness exposes a setter
  // that swaps the cook config returned by the handler's loadCookConfig
  // call. We re-route via existsSyncImpl + readFileSyncImpl returning a
  // JSON string.
  if (opts.autoUat === true || opts.configOverrides !== undefined) {
    const cfgJson = JSON.stringify({
      auto_uat: opts.autoUat ?? false,
      ...(opts.configOverrides?.qa_gate_overrides !== undefined
        ? { qa_gate_overrides: opts.configOverrides.qa_gate_overrides }
        : {}),
    });
    existsSyncImpl.mockImplementation((p: import('node:fs').PathLike) => {
      return String(p).endsWith('config.json');
    });
    readFileSyncImpl.mockImplementation((p: import('node:fs').PathOrFileDescriptor) => {
      if (String(p).endsWith('config.json')) return cfgJson;
      return STUB_COOK_MD;
    });
  }

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
    return handler(
      { verb: 'cook', positionals, flags },
      io,
    );
  }

  return {
    run,
    spawnImpl,
    askUserImpl,
    detectPhaseImpl,
    execSyncImpl,
    readFileSyncImpl,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

describe('@swt-labs/cli — cookHandler pre-parse (Plan 03-02 T5)', () => {
  it('D.0 — extractRefTag strips a trailing (ref:XXXXXXXX)', () => {
    const out = extractRefTag('do this thing (ref:abcd1234)');
    expect(out.args).toBe('do this thing');
    expect(out.refHash).toBe('abcd1234');
  });

  it('D.0 — extractRefTag returns args unchanged when no ref present', () => {
    const out = extractRefTag('do this thing');
    expect(out.args).toBe('do this thing');
    expect(out.refHash).toBeUndefined();
  });

  it("D.0' — resolveTodoNumber recognises a bare integer as a phase target", () => {
    const out = resolveTodoNumber('3', REPO_ROOT);
    expect(out.phaseTarget).toBe(3);
    expect(out.args).toBe('3');
  });

  it("D.0' — resolveTodoNumber ignores non-integer args", () => {
    const out = resolveTodoNumber('plan it', REPO_ROOT);
    expect(out.phaseTarget).toBeUndefined();
  });
});

describe('@swt-labs/cli — cookHandler routing priorities (Plan 03-02 T5 / D.1)', () => {
  it('D.1 priority 1 — planning_dir_exists=false → stderr + EXIT.SUCCESS, no spawn', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ planning_dir_exists: false }),
    });
    const exitCode = await h.run([]);
    expect(exitCode).toBe(0);
    expect(h.stderr()).toContain("Run 'swt init' first");
    expect(h.spawnImpl).not.toHaveBeenCalled();
  });

  it('D.1 priority 2 — project_exists=false → Bootstrap mode (after confirm)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ project_exists: false }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    const exitCode = await h.run([]);
    expect(exitCode).toBe(0);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    const callArgs = h.spawnImpl.mock.calls[0]?.[0];
    expect(callArgs?.prompt).toContain('### Mode: Bootstrap');
  });

  it('D.1 priority 3 — needs_uat_remediation → UAT Remediation mode (gated by auto_uat=false)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_uat_remediation' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    const callArgs = h.spawnImpl.mock.calls[0]?.[0];
    expect(callArgs?.prompt).toContain('### Mode: UAT Remediation');
  });

  it('D.1 priority 3.5 — needs_qa_remediation → QA Remediation (mapped to UAT Remediation heading)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_qa_remediation' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    const callArgs = h.spawnImpl.mock.calls[0]?.[0];
    // qa-remediation re-uses the UAT Remediation heading in cook.md today.
    expect(callArgs?.prompt).toContain('### Mode: UAT Remediation');
  });

  it('D.1 priority 4 — needs_reverification → execSync(prepare-reverification.sh) + Verify mode', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_reverification', next_phase: '02' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    // Plan 06-01 T2 — runMode now also invokes `git log` (best-effort) to
    // emit cook.task_commit. Filter on the prepare-reverification call so
    // this test stays narrow to its routing assertion.
    const prepareCalls = h.execSyncImpl.mock.calls.filter((c) =>
      String(c[0]).includes('prepare-reverification.sh'),
    );
    expect(prepareCalls.length).toBe(1);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Verify');
  });

  it('D.1 priority 5 — milestone_uat_issues=true → Milestone UAT Recovery (no confirm)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ milestone_uat_issues: true }),
    });
    await h.run([]);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Milestone UAT Recovery');
  });

  it('D.1 priority 6 — phase_count=0 → Scope mode (after confirm)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ phase_count: 0, next_phase_state: 'phase_count_zero' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Scope');
  });

  it('D.1 priority 7 — needs_verification + qa_status=passed → Verify mode', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_verification', qa_status: 'passed' }),
    });
    await h.run([]);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Verify');
  });

  it('D.1 priority 7 — needs_verification + qa_status=failed → re-route to QA Remediation (NOT verify)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_verification', qa_status: 'failed' }),
    });
    await h.run([]);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: UAT Remediation');
  });

  it('D.1 priority 8 — needs_discussion → Discuss mode (after confirm)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_discussion' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Discuss');
  });

  it('D.1 priority 9 — needs_plan_and_execute → Plan mode (after confirm)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_plan_and_execute' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Plan');
  });

  it('D.1 priority 10 — needs_execute → Execute mode (after confirm)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_execute' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Execute');
  });

  it('D.1 priority 11 — all_done + no qa-attention → Archive mode (after confirm)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'all_done' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Archive');
  });
});

describe('@swt-labs/cli — cookHandler flag-detection path (Plan 03-02 T5 / D.3)', () => {
  it('D.3 — --plan=01 routes to Plan mode without confirmation', async () => {
    const h = buildHarness({
      state: makePhaseDetect(),
    });
    await h.run([], { plan: '01' });
    expect(h.askUserImpl).not.toHaveBeenCalled();
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Plan');
  });

  it('D.3 — --execute routes to Execute mode without confirmation', async () => {
    const h = buildHarness({
      state: makePhaseDetect(),
    });
    await h.run([], { execute: true });
    expect(h.askUserImpl).not.toHaveBeenCalled();
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Execute');
  });

  it('D.3 — --archive routes to Archive mode without confirmation', async () => {
    const h = buildHarness({
      state: makePhaseDetect(),
    });
    await h.run([], { archive: true });
    expect(h.askUserImpl).not.toHaveBeenCalled();
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Archive');
  });
});

describe("@swt-labs/cli — cookHandler natural-language path (Plan 03-02 T5 / D.4)", () => {
  it("D.4 — \"let's plan the next phase\" enters askUser confirmation; accept → Plan mode", async () => {
    const h = buildHarness({
      state: makePhaseDetect(),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run(["let's", 'plan', 'the', 'next', 'phase']);
    expect(h.askUserImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Plan');
  });

  it('D.4 — NL routing reject → no spawn, EXIT.SUCCESS', async () => {
    const h = buildHarness({
      state: makePhaseDetect(),
      askResponses: [{ selectedOption: 'No', freeform: null }],
    });
    const exitCode = await h.run(['discuss', 'the', 'next', 'phase']);
    expect(exitCode).toBe(0);
    expect(h.askUserImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl).not.toHaveBeenCalled();
  });
});

describe('@swt-labs/cli — cookHandler confirmation gate (Plan 03-02 T5 / D.5)', () => {
  it('D.5 — Bootstrap rejection → no spawn, EXIT.SUCCESS', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ project_exists: false }),
      askResponses: [{ selectedOption: 'No', freeform: null }],
    });
    const exitCode = await h.run([]);
    expect(exitCode).toBe(0);
    expect(h.spawnImpl).not.toHaveBeenCalled();
  });
});

describe('@swt-labs/cli — cookHandler priority 4 reverification (Plan 03-02 T5 / D.6)', () => {
  it('D.6 — execSync failure surfaces EXIT.RUNTIME_ERROR; no spawn', async () => {
    const failingExec = (() => {
      throw new Error('prepare-reverification.sh: missing artifact');
    }) as unknown as typeof import('node:child_process').execSync;
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_reverification' }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
      execSyncImpl: failingExec,
    });
    const exitCode = await h.run([]);
    expect(exitCode).toBe(3); // EXIT.RUNTIME_ERROR
    expect(h.spawnImpl).not.toHaveBeenCalled();
    expect(h.stderr()).toContain('prepare-reverification.sh failed');
  });
});

describe('@swt-labs/cli — cookHandler fallback patterns (Plan 03-02 T5 / D.8)', () => {
  it('D.8 — all_done + first_qa_attention_phase + pending → Verify (NOT Archive)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({
        next_phase_state: 'all_done',
        first_qa_attention_phase: '03',
        first_qa_attention_slug: '03-foo',
        qa_attention_status: 'pending',
      }),
    });
    await h.run([]);
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: Verify');
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).not.toContain('### Mode: Archive');
  });

  it('D.8 — needs_execute + qa-attention failed → QA Remediation (NOT Execute)', async () => {
    const h = buildHarness({
      state: makePhaseDetect({
        next_phase_state: 'needs_execute',
        first_qa_attention_phase: '02',
        qa_attention_status: 'failed',
      }),
      askResponses: [{ selectedOption: 'Yes', freeform: null }],
    });
    await h.run([]);
    expect(h.spawnImpl.mock.calls[0]?.[0]?.prompt).toContain('### Mode: UAT Remediation');
  });
});

describe('@swt-labs/cli — cookHandler auto_uat config (Plan 03-02 T5 / D.10)', () => {
  it('D.10 — auto_uat=true skips confirmation on priority 3', async () => {
    const h = buildHarness({
      state: makePhaseDetect({ next_phase_state: 'needs_uat_remediation' }),
      autoUat: true,
    });
    await h.run([]);
    expect(h.askUserImpl).not.toHaveBeenCalled();
    expect(h.spawnImpl).toHaveBeenCalledTimes(1);
  });
});

describe('@swt-labs/cli — evaluateQaGate (Plan 03-02 T5 / D.7)', () => {
  it("D.7 — qa_status='passed' → proceed_to_uat", () => {
    const config: CookConfig = { auto_uat: false };
    const decision = evaluateQaGate(makePhaseDetect({ qa_status: 'passed' }), config);
    expect(decision.kind).toBe('proceed_to_uat');
  });

  it("D.7 — qa_status='remediated' → proceed_to_uat", () => {
    const config: CookConfig = { auto_uat: false };
    const decision = evaluateQaGate(makePhaseDetect({ qa_status: 'remediated' }), config);
    expect(decision.kind).toBe('proceed_to_uat');
  });

  it("D.7 — qa_status='pending' → run_qa_inline with reason label", () => {
    const config: CookConfig = { auto_uat: false };
    const decision = evaluateQaGate(
      makePhaseDetect({ qa_status: 'pending', qa_reason: 'missing_verification_artifact' }),
      config,
    );
    expect(decision.kind).toBe('run_qa_inline');
    if (decision.kind === 'run_qa_inline') {
      expect(decision.reason).toBe('missing_verification_artifact');
    }
  });

  it("D.7 — qa_status='failed' → init_qa_remediation", () => {
    const config: CookConfig = { auto_uat: false };
    const decision = evaluateQaGate(makePhaseDetect({ qa_status: 'failed' }), config);
    expect(decision.kind).toBe('init_qa_remediation');
  });

  it("D.7 — qa_reason='uat_cutover' → proceed_to_uat (overrides qa_status)", () => {
    const config: CookConfig = { auto_uat: false };
    const decision = evaluateQaGate(
      makePhaseDetect({ qa_status: 'pending', qa_reason: 'uat_cutover' }),
      config,
    );
    expect(decision.kind).toBe('proceed_to_uat');
  });

  it('D.9 — qa_gate_known_issues_override converts run_qa_inline → proceed_to_uat', () => {
    const config: CookConfig = {
      auto_uat: false,
      qa_gate_overrides: { qa_gate_known_issues_override: true },
    };
    const decision = evaluateQaGate(
      makePhaseDetect({ qa_status: 'pending', qa_reason: 'missing_verification_artifact' }),
      config,
    );
    expect(decision.kind).toBe('proceed_to_uat');
  });

  it('D.9 — qa_gate_deviation_override only fires for verification_result_unrecognized', () => {
    const config: CookConfig = {
      auto_uat: false,
      qa_gate_overrides: { qa_gate_deviation_override: true },
    };
    // Does NOT match — should still run inline.
    const decision1 = evaluateQaGate(
      makePhaseDetect({ qa_status: 'pending', qa_reason: 'missing_verification_artifact' }),
      config,
    );
    expect(decision1.kind).toBe('run_qa_inline');
    // Matches — converts to proceed_to_uat.
    const decision2 = evaluateQaGate(
      makePhaseDetect({ qa_status: 'pending', qa_reason: 'verification_result_unrecognized' }),
      config,
    );
    expect(decision2.kind).toBe('proceed_to_uat');
  });
});
