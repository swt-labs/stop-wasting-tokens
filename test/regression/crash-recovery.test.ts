import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { probeForResume } from '../../packages/cli/src/commands/cook.js';
import {
  writeExecutionState,
  type ExecutionStateRecord,
} from '../../packages/methodology/src/state/execution-state.js';

/**
 * Plan 06-01 (Phase 6) T4 — Crash-recovery chaos regression test.
 *
 * REQ-11 verification per ROADMAP Phase 6 line 144 ("kill -9 mid-execute
 * resumes ..."). Simulates the crash + resume protocol entirely from
 * fixtures (no real Pi spawn — the chaos surface is the .execution-state
 * + events JSONL + PidChecker liveness probe trio).
 *
 * Two scenarios:
 *
 *   1. Crashed-prior-session — execution-state.status=in_progress + pid
 *      dead + journal shows T1 committed + T2 started-but-not-committed.
 *      Asserts probeForResume returns {action:'resume', fromTask:'T2',
 *      lastCommitHash:'aaa111'}. The next cook invocation re-runs T2 from
 *      scratch (NOT a replay of T1).
 *
 *   2. Live concurrent cook — execution-state.pid = this very test
 *      process's pid (definitely alive). Asserts probeForResume returns
 *      {action:'abort_another_cook_running'} and refuses to race.
 *
 * Cited in `docs/operations/crash-recovery.md` as the test that proves
 * the per-task-commit granularity contract.
 */

let dir: string;

const SID = 'crash-test-1';
const STARTED_AT = '2026-05-13T12:34:56.789Z';
const DEAD_PID = 999999999;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-crash-recovery-'));
  fs.mkdirSync(join(dir, '.vbw-planning'), { recursive: true });
  fs.mkdirSync(join(dir, '.swt-planning', '.events'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function seedExecutionState(overrides: Partial<ExecutionStateRecord> = {}): void {
  const state: ExecutionStateRecord = {
    phase: 6,
    phase_name: 'hardening',
    status: 'in_progress',
    wave: 1,
    total_waves: 2,
    plans: [{ plan: '06-01', status: 'in_progress' }],
    correlation_id: SID,
    session_id: SID,
    pid: DEAD_PID,
    started_at: STARTED_AT,
    ...overrides,
  };
  writeExecutionState(dir, state);
}

function eventsFilePath(): string {
  const sanitized = STARTED_AT.replace(/[:.]/g, '-');
  return join(dir, '.swt-planning', '.events', `cook-${SID}-${sanitized}.jsonl`);
}

function writeJournal(lines: ReadonlyArray<Record<string, unknown>>): void {
  fs.writeFileSync(
    eventsFilePath(),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

const deadPidChecker = (): 'dead' => 'dead';
const alivePidChecker = (): 'alive' => 'alive';

describe('chaos — crash recovery', () => {
  it('mid-task crash → resume at the in-flight task, NOT a replay of the committed one', () => {
    seedExecutionState();
    writeJournal([
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T1', ts: STARTED_AT },
      {
        type: 'cook.task_commit',
        session_id: SID,
        plan: '06-01',
        task_id: 'T1',
        commit_hash: 'aaa111',
        ts: STARTED_AT,
      },
      // T2 began but never committed — simulated kill -9 mid-task.
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T2', ts: STARTED_AT },
    ]);

    const decision = probeForResume(dir, { pidChecker: deadPidChecker });

    expect(decision.kind).toBe('resume');
    if (decision.kind === 'resume') {
      expect(decision.fromTask).toBe('T2');
      expect(decision.lastCommitHash).toBe('aaa111');
    }
  });

  it('live concurrent cook → abort, do NOT emit cook.resume + do NOT race', () => {
    // pid = this test process's pid (guaranteed alive).
    seedExecutionState({ pid: process.pid });
    writeJournal([
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T1', ts: STARTED_AT },
    ]);

    const decision = probeForResume(dir, { pidChecker: alivePidChecker });

    expect(decision.kind).toBe('abort_another_cook_running');
    if (decision.kind === 'abort_another_cook_running') {
      expect(decision.pid).toBe(process.pid);
    }

    // The journal must NOT have been mutated by the probe — probeForResume
    // is a pure decision function; only cookHandler materializes side
    // effects (which we don't invoke here).
    const raw = fs.readFileSync(eventsFilePath(), 'utf8');
    expect(raw).not.toContain('cook.resume');
  });

  it('clean prior session → fresh_run reason=prior_completed (stale state flipped by cookHandler)', () => {
    seedExecutionState();
    writeJournal([
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T1', ts: STARTED_AT },
      {
        type: 'cook.task_commit',
        session_id: SID,
        plan: '06-01',
        task_id: 'T1',
        commit_hash: 'aaa111',
        ts: STARTED_AT,
      },
      { type: 'cook.task_complete', session_id: SID, plan: '06-01', task_id: 'T1', ts: STARTED_AT },
      { type: 'cook.completion', session_id: SID, status: 'success', ts: STARTED_AT },
    ]);

    const decision = probeForResume(dir, { pidChecker: deadPidChecker });

    expect(decision.kind).toBe('fresh_run');
    if (decision.kind === 'fresh_run') {
      expect(decision.reason).toBe('prior_completed');
    }
  });
});
