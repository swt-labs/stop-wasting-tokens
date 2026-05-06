import type { VerificationTier, AgentRole } from '@swt-labs/core';

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
