import type { VerificationTier, AgentRole } from '@swt-labs/core';

import {
  DEFAULT_STATIC_CHECKS,
  type StaticCheck,
  type StaticCheckResult,
} from './checks/static-checks.js';

/**
 * QA verification ladder per TDD2 §11.2.
 *
 * Runs the static-check ladder (typecheck → lint → format → tests) and
 * short-circuits on first failure. If a check fails AND an `escalator` is
 * provided, the runner dispatches the failure to the LLM-tier escalator
 * (M2 PR-15 wires this to the QA agent through the orchestration
 * dispatcher); otherwise it returns `status: 'failed'` with the failing
 * `StaticCheckResult` so the caller can route to remediation manually.
 *
 * The runner is a pure orchestrator — it owns the ladder order + the
 * escalation decision; it doesn't own the checks themselves (those are
 * `StaticCheck` values) or the LLM call (that's the injected
 * `LlmVerificationEscalator`). Dependency-injection by-construction.
 */

export type VerificationStatus = 'passed' | 'failed' | 'escalated';

export interface LlmVerificationReport {
  readonly status: 'recovered' | 'unrecoverable';
  /** Free-form notes from the QA agent — surfaced in the SUMMARY.md body. */
  readonly notes: string;
  /** Optional list of remediation hints surfaced by the agent. */
  readonly remediation_hints?: ReadonlyArray<string>;
}

export interface LlmVerificationEscalator {
  /**
   * Dispatch the failing check to an LLM-tier agent (QA role at M2; M3+
   * may route to Debugger for `xhigh` thinking). The escalator MUST resolve
   * without throwing — failure paths return `{ status: 'unrecoverable', ... }`.
   */
  escalate(
    failure: StaticCheckResult,
    context: LlmEscalationContext,
  ): Promise<LlmVerificationReport>;
}

export interface LlmEscalationContext {
  readonly cwd: string;
  /** Phase identifier (e.g., '01') so the agent can ground its analysis. */
  readonly phase?: string;
  /** Optional plan identifier (e.g., '01') for plan-scoped escalation. */
  readonly plan?: string;
}

export interface VerificationRunOptions {
  readonly cwd: string;
  /** Override the ladder (test injection); defaults to `DEFAULT_STATIC_CHECKS`. */
  readonly checks?: ReadonlyArray<StaticCheck>;
  /** Optional LLM escalator. When omitted, failure returns `status: 'failed'`. */
  readonly escalator?: LlmVerificationEscalator;
  /** Forwarded to the escalator for grounding. */
  readonly context?: Omit<LlmEscalationContext, 'cwd'>;
}

export interface VerificationLadderResult {
  readonly status: VerificationStatus;
  readonly checks: ReadonlyArray<StaticCheckResult>;
  /** The first failing check (if any). */
  readonly failedCheck?: StaticCheckResult;
  /** Set only when `status === 'escalated'`. */
  readonly llmReport?: LlmVerificationReport;
}

/**
 * Run the static-check ladder. Short-circuits on the first failure: if an
 * escalator is provided, dispatches the failing check to the LLM and
 * returns `status: 'escalated'`; otherwise returns `status: 'failed'`.
 * Returns `status: 'passed'` only when every check in the ladder passes.
 */
export async function runVerificationLadder(
  opts: VerificationRunOptions,
): Promise<VerificationLadderResult> {
  const checks = opts.checks ?? DEFAULT_STATIC_CHECKS;
  const results: StaticCheckResult[] = [];
  for (const check of checks) {
    const result = await check.run(opts.cwd);
    results.push(result);
    if (result.status === 'failed') {
      if (opts.escalator !== undefined) {
        const llmReport = await opts.escalator.escalate(result, {
          cwd: opts.cwd,
          ...(opts.context ?? {}),
        });
        return {
          status: 'escalated',
          checks: results,
          failedCheck: result,
          llmReport,
        };
      }
      return {
        status: 'failed',
        checks: results,
        failedCheck: result,
      };
    }
  }
  return { status: 'passed', checks: results };
}

/** A no-op escalator. Use in tests or until M2 PR-15 wires the real one. */
export const NOOP_ESCALATOR: LlmVerificationEscalator = {
  async escalate(failure): Promise<LlmVerificationReport> {
    return {
      status: 'unrecoverable',
      notes: `NOOP escalator — would have dispatched ${failure.name} failure to the QA agent.`,
    };
  },
};

export interface QaCheck {
  readonly id: string;
  readonly must_have: string;
  readonly status: 'pass' | 'fail' | 'partial' | 'deferred';
  readonly evidence: string;
}

export interface QaRunnerInput {
  readonly tier: VerificationTier;
  readonly phase: string;
  readonly plans_verified: readonly string[];
  readonly checks: readonly QaCheck[];
  /** Optional traceability findings to fold into the result on `deep`. */
  readonly traceability_ok?: boolean;
}

export interface QaRunnerOutput {
  readonly phase: string;
  readonly plans_verified: readonly string[];
  readonly result: 'pass' | 'fail' | 'partial';
  readonly checks: readonly QaCheck[];
  /** Reason a result was downgraded (or empty when result is pass). */
  readonly downgrade_reason?: string;
  readonly required_role: AgentRole;
}

export function runQa(input: QaRunnerInput): QaRunnerOutput {
  const fail = input.checks.some((c) => c.status === 'fail');
  const partial = input.checks.some((c) => c.status === 'partial');
  let result: QaRunnerOutput['result'] = 'pass';
  let downgrade: string | undefined;

  if (fail) {
    result = 'fail';
    downgrade = 'one or more checks failed';
  } else if (partial) {
    result = 'partial';
    downgrade = 'one or more checks are partial';
  }

  if (input.tier !== 'quick') {
    for (const check of input.checks) {
      if (check.status === 'pass' && check.evidence.trim().length === 0) {
        result = result === 'fail' ? 'fail' : 'partial';
        downgrade = downgrade ?? 'a passing check has no evidence';
      }
    }
  }

  if (input.tier === 'deep' && input.traceability_ok === false) {
    result = result === 'pass' ? 'partial' : result;
    downgrade = downgrade ?? 'traceability gaps detected';
  }

  return {
    phase: input.phase,
    plans_verified: input.plans_verified,
    result,
    checks: input.checks,
    ...(downgrade !== undefined ? { downgrade_reason: downgrade } : {}),
    required_role: 'qa',
  };
}
