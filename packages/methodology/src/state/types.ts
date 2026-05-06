export type NextPhaseState =
  | 'phase_count_zero'
  | 'needs_discussion'
  | 'needs_plan_and_execute'
  | 'needs_execute'
  | 'needs_verification'
  | 'needs_qa_remediation'
  | 'needs_uat_remediation'
  | 'needs_reverification'
  | 'all_done';

export type QaStatus = 'pending' | 'passed' | 'failed' | 'remediating' | 'remediated' | 'none';

export type QaAttentionStatus = 'pending' | 'failed' | 'none';

export type ExecutionState = 'none' | 'in_progress' | 'paused';

export interface PhaseDetectResult {
  // Environment
  jq_available: boolean;
  planning_dir_exists: boolean;
  project_exists: boolean;
  phases_dir: string;
  has_shipped_milestones: boolean;
  needs_milestone_rename: boolean;

  // Phase summary
  phase_count: number;
  next_phase: string | undefined; // "01"-padded; undefined when phase_count=0
  next_phase_slug: string | undefined;
  next_phase_state: NextPhaseState;
  next_phase_plans: number;
  next_phase_summaries: number;

  // Verification freshness
  has_unverified_phases: boolean;
  first_unverified_phase: string | undefined;
  first_unverified_slug: string | undefined;
  first_qa_attention_phase: string | undefined;
  first_qa_attention_slug: string | undefined;
  qa_attention_status: QaAttentionStatus;
  qa_attention_reason: string;
  qa_status: QaStatus;
  qa_reason: string;
  qa_round: string; // "00"-padded

  // UAT
  uat_issues_phase: string;
  uat_issues_slug: string;
  uat_issues_major_or_higher: boolean;
  uat_issues_phases: string; // pipe-separated
  uat_issues_count: number;
  uat_file: string;
  uat_round_count: number;
  misnamed_plans: boolean;

  // Milestone-level UAT recovery
  milestone_uat_issues: boolean;
  milestone_uat_phase: string;
  milestone_uat_slug: string;
  milestone_uat_major_or_higher: boolean;
  milestone_uat_phase_dir: string;
  milestone_uat_count: number;
  milestone_uat_phase_dirs: string;

  // Config mirrors
  config_effort: string;
  config_autonomy: string;
  config_auto_commit: boolean;
  config_planning_tracking: string;
  config_auto_push: string;
  config_verification_tier: string;
  config_prefer_teams: string;
  config_max_tasks_per_plan: number;
  config_context_compiler: boolean;
  config_require_phase_discussion: boolean;
  config_auto_uat: boolean;
  config_compaction_threshold: number;

  // Codebase / runtime
  has_codebase_map: boolean;
  brownfield: boolean;
  execution_state: ExecutionState;
  phase_detect_complete: true;
}

export interface PhaseSnapshot {
  position: string; // "01"
  slug: string;
  dir: string; // absolute path
  hasContext: boolean;
  hasResearch: boolean;
  planCount: number;
  summaryCount: number;
  verification: VerificationSnapshot | undefined;
  uat: UatSnapshot | undefined;
  qaRemediation: QaRemediationSnapshot | undefined;
  uatRemediation: UatRemediationSnapshot | undefined;
}

export interface VerificationSnapshot {
  /** Path relative to the phase dir, e.g. "01-VERIFICATION.md". */
  filename: string;
  /** Top-level result token from frontmatter. */
  result: 'PASS' | 'FAIL' | 'PARTIAL' | 'unknown';
  /** Optional `verified_at_commit` from frontmatter. */
  verifiedAtCommit: string | undefined;
}

export interface UatSnapshot {
  filename: string;
  status: 'in_progress' | 'complete' | 'issues_found' | 'unknown';
  major_or_higher: boolean;
}

export interface QaRemediationSnapshot {
  stage: 'plan' | 'execute' | 'verify' | 'done' | 'none';
  round: string; // "01" .. "NN"
}

export interface UatRemediationSnapshot {
  stage: 'research' | 'plan' | 'execute' | 'fix' | 'done' | 'none';
  round: string;
  layout: 'round-dir' | 'legacy';
}
