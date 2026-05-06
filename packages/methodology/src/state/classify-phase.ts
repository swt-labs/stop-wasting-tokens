import type { NextPhaseState, PhaseSnapshot, QaStatus } from './types.js';

export interface ClassifyPhaseInput {
  readonly snapshot: PhaseSnapshot;
  readonly requirePhaseDiscussion: boolean;
  readonly autoUat: boolean;
  /** Result of the QA freshness check (when verification artefacts exist). */
  readonly qaFreshness: QaFreshnessResult;
}

export interface QaFreshnessResult {
  /** True when the latest VERIFICATION.md is structurally usable. */
  readonly hasVerification: boolean;
  /** True when product code has changed since QA verified it. */
  readonly stale: boolean;
  /** Optional reason token compatible with the bash script's qa_reason values. */
  readonly reason: string;
}

export interface PhaseClassification {
  readonly state: NextPhaseState;
  readonly qaStatus: QaStatus;
  readonly qaReason: string;
}

/**
 * Decide a single phase's state and QA status from its snapshot. The orchestrator
 * (phase-detect.ts) iterates through the phase list and uses the first
 * non-`all_done` classification to drive routing.
 */
export function classifyPhase(input: ClassifyPhaseInput): PhaseClassification {
  const s = input.snapshot;

  // 1. Active UAT remediation takes priority over any QA work.
  const uatStage = s.uatRemediation?.stage;
  if (uatStage === 'research' || uatStage === 'plan' || uatStage === 'execute' || uatStage === 'fix') {
    return { state: 'needs_uat_remediation', qaStatus: 'remediated', qaReason: '' };
  }
  if (uatStage === 'done') {
    // Remediation complete — re-verify required.
    return { state: 'needs_reverification', qaStatus: 'remediated', qaReason: '' };
  }

  // 2. Phase-level UAT issues (no remediation started yet).
  if (s.uat?.status === 'issues_found') {
    return { state: 'needs_uat_remediation', qaStatus: 'remediated', qaReason: '' };
  }

  // 3. Active QA remediation.
  const qaStage = s.qaRemediation?.stage;
  if (qaStage === 'plan' || qaStage === 'execute' || qaStage === 'verify') {
    return { state: 'needs_qa_remediation', qaStatus: 'remediating', qaReason: '' };
  }

  // 4. Plan / Summary / Verification gating.
  if (s.planCount === 0) {
    if (input.requirePhaseDiscussion && !s.hasContext) {
      return { state: 'needs_discussion', qaStatus: 'none', qaReason: '' };
    }
    return { state: 'needs_plan_and_execute', qaStatus: 'none', qaReason: '' };
  }
  if (s.summaryCount < s.planCount) {
    return { state: 'needs_execute', qaStatus: 'none', qaReason: '' };
  }

  // 5. Built phase — evaluate QA + UAT terminal states.
  const verification = s.verification;
  if (verification === undefined) {
    return {
      state: 'needs_verification',
      qaStatus: 'pending',
      qaReason: 'missing_verification_artifact',
    };
  }
  if (verification.result === 'FAIL' || verification.result === 'PARTIAL') {
    return { state: 'needs_qa_remediation', qaStatus: 'failed', qaReason: 'verification_result_missing' };
  }
  if (verification.result === 'unknown') {
    return {
      state: 'needs_verification',
      qaStatus: 'pending',
      qaReason: 'verification_result_unrecognized',
    };
  }
  if (input.qaFreshness.stale) {
    return {
      state: 'needs_verification',
      qaStatus: 'pending',
      qaReason: input.qaFreshness.reason || 'verified_at_commit_mismatch',
    };
  }

  // 6. QA passed and fresh. Now check UAT (gated by auto_uat).
  if (input.autoUat) {
    if (s.uat === undefined) {
      return { state: 'needs_verification', qaStatus: 'passed', qaReason: '' };
    }
    if (s.uat.status === 'in_progress' || s.uat.status === 'unknown') {
      return { state: 'needs_verification', qaStatus: 'passed', qaReason: '' };
    }
    // status === 'complete' (terminal pass) → phase done.
  } else {
    // auto_uat=false — only consider it "done" when SUMMARY+VERIFICATION line up.
  }

  return { state: 'all_done', qaStatus: verification.result === 'PASS' ? 'passed' : 'remediated', qaReason: '' };
}
