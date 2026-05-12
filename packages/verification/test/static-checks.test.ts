/**
 * Static-check ladder + LLM-escalation contract tests (M2 PR-14).
 *
 * These tests exercise the ladder semantics (order, short-circuit, escalation
 * routing) with synthetic in-memory `StaticCheck` values — no real `pnpm`
 * invocation. The real shell-spawn path is covered by the integration-style
 * `static-checks` themselves (verified by running `pnpm test` in this repo).
 */

import { describe, expect, it } from 'vitest';

import type { StaticCheck, StaticCheckResult } from '../src/checks/static-checks.js';
import {
  NOOP_ESCALATOR,
  runVerificationLadder,
  type LlmVerificationEscalator,
  type LlmVerificationReport,
} from '../src/runner.js';

function makeStaticCheck(name: string, status: 'passed' | 'failed', exitCode = 0): StaticCheck {
  return {
    name,
    async run(): Promise<StaticCheckResult> {
      return {
        name,
        status,
        exitCode: status === 'passed' ? 0 : exitCode === 0 ? 1 : exitCode,
        durationMs: 1,
        outputTail: `synthetic ${name} ${status} output`,
      };
    },
  };
}

function makeRecordingEscalator(report: LlmVerificationReport): {
  readonly escalator: LlmVerificationEscalator;
  readonly calls: StaticCheckResult[];
} {
  const calls: StaticCheckResult[] = [];
  const escalator: LlmVerificationEscalator = {
    async escalate(failure): Promise<LlmVerificationReport> {
      calls.push(failure);
      return report;
    },
  };
  return { escalator, calls };
}

describe('runVerificationLadder', () => {
  it('returns status=passed when every check in the ladder passes', async () => {
    const result = await runVerificationLadder({
      cwd: '/tmp/test',
      checks: [
        makeStaticCheck('typecheck', 'passed'),
        makeStaticCheck('lint', 'passed'),
        makeStaticCheck('format', 'passed'),
        makeStaticCheck('tests', 'passed'),
      ],
    });
    expect(result.status).toBe('passed');
    expect(result.checks).toHaveLength(4);
    expect(result.failedCheck).toBeUndefined();
    expect(result.llmReport).toBeUndefined();
  });

  it('short-circuits on the FIRST failing check (subsequent checks are NOT run)', async () => {
    const lintInvocations: string[] = [];
    const recordingLint: StaticCheck = {
      name: 'lint',
      async run(): Promise<StaticCheckResult> {
        lintInvocations.push('called');
        return {
          name: 'lint',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          outputTail: '',
        };
      },
    };
    const result = await runVerificationLadder({
      cwd: '/tmp/test',
      checks: [makeStaticCheck('typecheck', 'failed'), recordingLint],
    });
    expect(result.status).toBe('failed');
    expect(result.failedCheck?.name).toBe('typecheck');
    expect(result.checks).toHaveLength(1);
    expect(lintInvocations).toEqual([]); // lint was never run
  });

  it('escalates to the LLM when a check fails AND an escalator is provided', async () => {
    const { escalator, calls } = makeRecordingEscalator({
      status: 'recovered',
      notes: 'fixed it',
      remediation_hints: ['add a return type to foo()'],
    });
    const result = await runVerificationLadder({
      cwd: '/tmp/test',
      checks: [
        makeStaticCheck('typecheck', 'passed'),
        makeStaticCheck('lint', 'failed', 2),
        makeStaticCheck('format', 'passed'), // never reached
      ],
      escalator,
    });
    expect(result.status).toBe('escalated');
    expect(result.failedCheck?.name).toBe('lint');
    expect(result.llmReport?.status).toBe('recovered');
    expect(result.llmReport?.remediation_hints).toEqual(['add a return type to foo()']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('lint');
  });

  it('forwards phase + plan context to the escalator', async () => {
    let capturedCwd: string | undefined;
    let capturedPhase: string | undefined;
    let capturedPlan: string | undefined;
    const escalator: LlmVerificationEscalator = {
      async escalate(_failure, ctx): Promise<LlmVerificationReport> {
        capturedCwd = ctx.cwd;
        capturedPhase = ctx.phase;
        capturedPlan = ctx.plan;
        return { status: 'unrecoverable', notes: 'stub' };
      },
    };
    await runVerificationLadder({
      cwd: '/tmp/cwd-x',
      checks: [makeStaticCheck('typecheck', 'failed')],
      escalator,
      context: { phase: '01', plan: '02' },
    });
    expect(capturedCwd).toBe('/tmp/cwd-x');
    expect(capturedPhase).toBe('01');
    expect(capturedPlan).toBe('02');
  });

  it('returns status=failed (NOT escalated) when no escalator is provided', async () => {
    const result = await runVerificationLadder({
      cwd: '/tmp/test',
      checks: [makeStaticCheck('typecheck', 'failed')],
    });
    expect(result.status).toBe('failed');
    expect(result.failedCheck?.name).toBe('typecheck');
    expect(result.llmReport).toBeUndefined();
  });

  it('preserves the canonical ladder order (typecheck → lint → format → tests)', async () => {
    const order: string[] = [];
    const recordingCheck = (name: string): StaticCheck => ({
      name,
      async run(): Promise<StaticCheckResult> {
        order.push(name);
        return {
          name,
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          outputTail: '',
        };
      },
    });
    await runVerificationLadder({
      cwd: '/tmp/test',
      checks: [
        recordingCheck('typecheck'),
        recordingCheck('lint'),
        recordingCheck('format'),
        recordingCheck('tests'),
      ],
    });
    expect(order).toEqual(['typecheck', 'lint', 'format', 'tests']);
  });

  it('NOOP_ESCALATOR returns an unrecoverable report', async () => {
    const report = await NOOP_ESCALATOR.escalate(
      {
        name: 'typecheck',
        status: 'failed',
        exitCode: 1,
        durationMs: 5,
        outputTail: 'tsc error',
      },
      { cwd: '/tmp/test' },
    );
    expect(report.status).toBe('unrecoverable');
    expect(report.notes).toContain('typecheck');
  });
});
