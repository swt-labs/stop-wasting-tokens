import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeExecutionState, type ExecutionStateRecord } from '@swt-labs/methodology';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { probeForResume } from '../../src/commands/cook.js';

/**
 * Plan 06-01 (Phase 6) T3 — resume probe truth table tests.
 *
 * The probe is a pure decision function. It reads `.execution-state.json`
 * + tails the cook events JSONL and returns one of five decisions:
 *
 *   no_state                    — no execution-state.json on disk
 *   paused_resume               — status='paused' (out-of-scope; existing protocol)
 *   abort_another_cook_running  — recorded pid is alive
 *   fresh_run{reason}           — three-condition AND is broken
 *   resume{fromTask, hash}      — three-condition AND holds
 *
 * All branches exercised below.
 */

let dir: string;

const TS = '2026-05-13T00:00:00.000Z';
const SID = 'cook-resume-test';
const DEAD_PID = 999999999;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-cook-resume-'));
  // The execution-state.ts resolver prefers .vbw-planning when present
  // (matches this repo's plugin co-existence layout per CLAUDE.md). Seed
  // both planning roots so the events file path resolves regardless.
  fs.mkdirSync(join(dir, '.vbw-planning'), { recursive: true });
  fs.mkdirSync(join(dir, '.swt-planning', '.events'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleState(overrides: Partial<ExecutionStateRecord> = {}): ExecutionStateRecord {
  return {
    phase: 6,
    phase_name: 'execute',
    status: 'in_progress',
    wave: 0,
    total_waves: 0,
    plans: [{ plan: '06-01', status: 'in_progress' }],
    correlation_id: 'corr-1',
    session_id: SID,
    pid: DEAD_PID,
    started_at: TS,
    ...overrides,
  };
}

function eventsFilePath(): string {
  // Mirror cook.ts:eventsFilePath sanitization (`:` and `.` → `-`).
  const sanitized = TS.replace(/[:.]/g, '-');
  return join(dir, '.swt-planning', '.events', `cook-${SID}-${sanitized}.jsonl`);
}

function writeJournal(lines: ReadonlyArray<Record<string, unknown>>): void {
  const file = eventsFilePath();
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const deadPidChecker = (): 'dead' => 'dead';
const alivePidChecker = (): 'alive' => 'alive';

describe('@swt-labs/cli — probeForResume truth table', () => {
  it('no_state when execution-state.json is absent', () => {
    expect(probeForResume(dir, { pidChecker: deadPidChecker })).toEqual({ kind: 'no_state' });
  });

  it('fresh_run prior_completed when status=completed', () => {
    writeExecutionState(dir, sampleState({ status: 'completed' }));
    expect(probeForResume(dir, { pidChecker: deadPidChecker })).toEqual({
      kind: 'fresh_run',
      reason: 'prior_status_completed',
    });
  });

  it('paused_resume when status=paused', () => {
    writeExecutionState(dir, sampleState({ status: 'paused' }));
    expect(probeForResume(dir, { pidChecker: deadPidChecker })).toEqual({
      kind: 'paused_resume',
    });
  });

  it('abort_another_cook_running when recorded pid is alive', () => {
    writeExecutionState(dir, sampleState({ pid: process.pid }));
    const result = probeForResume(dir, { pidChecker: alivePidChecker });
    expect(result.kind).toBe('abort_another_cook_running');
    if (result.kind === 'abort_another_cook_running') {
      expect(result.pid).toBe(process.pid);
    }
  });

  it('fresh_run no_journal when no events JSONL exists for the recorded session', () => {
    writeExecutionState(dir, sampleState());
    expect(probeForResume(dir, { pidChecker: deadPidChecker })).toEqual({
      kind: 'fresh_run',
      reason: 'no_journal',
    });
  });

  it('fresh_run prior_completed when cook.completion is present in the journal', () => {
    writeExecutionState(dir, sampleState());
    writeJournal([
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T1' },
      {
        type: 'cook.task_commit',
        session_id: SID,
        plan: '06-01',
        task_id: 'T1',
        commit_hash: 'abc',
      },
      { type: 'cook.task_complete', session_id: SID, plan: '06-01', task_id: 'T1' },
      { type: 'cook.completion', session_id: SID, status: 'success' },
    ]);
    expect(probeForResume(dir, { pidChecker: deadPidChecker })).toEqual({
      kind: 'fresh_run',
      reason: 'prior_completed',
    });
  });

  it('resume points at the next task after the last commit when no in-flight task_start remains', () => {
    writeExecutionState(dir, sampleState());
    writeJournal([
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T1' },
      {
        type: 'cook.task_commit',
        session_id: SID,
        plan: '06-01',
        task_id: 'T1',
        commit_hash: 'aaa111',
      },
      { type: 'cook.task_complete', session_id: SID, plan: '06-01', task_id: 'T1' },
    ]);
    const result = probeForResume(dir, { pidChecker: deadPidChecker });
    expect(result.kind).toBe('resume');
    if (result.kind === 'resume') {
      // High-water mark: last commit was T1; resume points at the next.
      expect(result.lastCommitHash).toBe('aaa111');
      expect(result.fromTask).toBe('T1_next');
    }
  });

  it('resume points at the in-flight task when task_start has no matching commit (mid-task crash)', () => {
    writeExecutionState(dir, sampleState());
    writeJournal([
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T1' },
      {
        type: 'cook.task_commit',
        session_id: SID,
        plan: '06-01',
        task_id: 'T1',
        commit_hash: 'aaa111',
      },
      // T2 started but never committed — simulated crash mid-task.
      { type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T2' },
    ]);
    const result = probeForResume(dir, { pidChecker: deadPidChecker });
    expect(result.kind).toBe('resume');
    if (result.kind === 'resume') {
      // The in-flight task is the one to re-run from scratch — NOT a
      // replay of the committed T1.
      expect(result.fromTask).toBe('T2');
      expect(result.lastCommitHash).toBe('aaa111');
    }
  });

  it('three-condition AND breaks if pid is alive even when status=in_progress + no completion', () => {
    writeExecutionState(dir, sampleState({ pid: process.pid }));
    writeJournal([{ type: 'cook.task_start', session_id: SID, plan: '06-01', task_id: 'T1' }]);
    const result = probeForResume(dir, { pidChecker: alivePidChecker });
    // The probe must NOT claim resume — recorded pid alive means another
    // cook is racing and we abort rather than double-run.
    expect(result.kind).toBe('abort_another_cook_running');
  });
});
