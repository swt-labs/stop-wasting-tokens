import type { PhaseDetectResult } from './types.js';

const KEY_ORDER: ReadonlyArray<keyof PhaseDetectResult> = [
  'jq_available',
  'planning_dir_exists',
  'project_exists',
  'phases_dir',
  'has_shipped_milestones',
  'needs_milestone_rename',
  'phase_count',
  'next_phase',
  'next_phase_slug',
  'next_phase_state',
  'next_phase_plans',
  'next_phase_summaries',
  'has_unverified_phases',
  'first_unverified_phase',
  'first_unverified_slug',
  'first_qa_attention_phase',
  'first_qa_attention_slug',
  'qa_attention_status',
  'qa_attention_reason',
  'qa_status',
  'qa_reason',
  'qa_round',
  'uat_issues_phase',
  'uat_issues_slug',
  'uat_issues_major_or_higher',
  'uat_issues_phases',
  'uat_issues_count',
  'uat_file',
  'uat_round_count',
  'misnamed_plans',
  'milestone_uat_issues',
  'milestone_uat_phase',
  'milestone_uat_slug',
  'milestone_uat_major_or_higher',
  'milestone_uat_phase_dir',
  'milestone_uat_count',
  'milestone_uat_phase_dirs',
  'config_effort',
  'config_autonomy',
  'config_auto_commit',
  'config_planning_tracking',
  'config_auto_push',
  'config_verification_tier',
  'config_prefer_teams',
  'config_max_tasks_per_plan',
  'config_context_compiler',
  'config_require_phase_discussion',
  'config_auto_uat',
  'config_compaction_threshold',
  'has_codebase_map',
  'brownfield',
  'execution_state',
  'phase_detect_complete',
];

/**
 * Render a PhaseDetectResult as `key=value` lines in the same order VBW's
 * phase-detect.sh emits. Useful for scripts/consumers that still expect the
 * bash format.
 */
export function toKeyValueLines(result: PhaseDetectResult): string {
  const lines: string[] = [];
  for (const key of KEY_ORDER) {
    const value = result[key];
    lines.push(`${key}=${formatValue(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value);
}
