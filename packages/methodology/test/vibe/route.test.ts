import { describe, expect, it } from 'vitest';

import type { PhaseDetectResult } from '../../src/state/types.js';
import { routeFromState } from '../../src/vibe/route.js';

function baseState(overrides: Partial<PhaseDetectResult> = {}): PhaseDetectResult {
  const base: PhaseDetectResult = {
    jq_available: true,
    planning_dir_exists: true,
    project_exists: true,
    phases_dir: '.swt-planning/phases',
    has_shipped_milestones: false,
    needs_milestone_rename: false,
    phase_count: 1,
    next_phase: '01',
    next_phase_slug: '01-foo',
    next_phase_state: 'all_done',
    next_phase_plans: 1,
    next_phase_summaries: 1,
    has_unverified_phases: false,
    first_unverified_phase: undefined,
    first_unverified_slug: undefined,
    first_qa_attention_phase: undefined,
    first_qa_attention_slug: undefined,
    qa_attention_status: 'none',
    qa_attention_reason: 'none',
    qa_status: 'passed',
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
  };
  return { ...base, ...overrides };
}

describe('routeFromState — priority table', () => {
  it('priority 1: planning_dir_exists=false → bootstrap (no intermediate init step)', () => {
    const r = routeFromState(baseState({ planning_dir_exists: false }));
    expect(r.kind).toBe('bootstrap');
    expect(r.requires_confirmation).toBe(true);
  });

  it('priority 1: project_exists=false → bootstrap', () => {
    const r = routeFromState(baseState({ project_exists: false }));
    expect(r.kind).toBe('bootstrap');
  });

  it('priority 3: needs_uat_remediation → uat-remediation', () => {
    const r = routeFromState(baseState({ next_phase_state: 'needs_uat_remediation' }));
    expect(r.kind).toBe('uat-remediation');
  });

  it('priority 3.5: needs_qa_remediation → qa-remediation', () => {
    const r = routeFromState(baseState({ next_phase_state: 'needs_qa_remediation' }));
    expect(r.kind).toBe('qa-remediation');
  });

  it('priority 4: needs_reverification → re-verify', () => {
    const r = routeFromState(baseState({ next_phase_state: 'needs_reverification' }));
    expect(r.kind).toBe('re-verify');
  });

  it('priority 5: milestone_uat_issues=true → milestone-uat-recovery', () => {
    const r = routeFromState(
      baseState({
        milestone_uat_issues: true,
        milestone_uat_phase: '03',
        milestone_uat_slug: '03-foo',
        next_phase_state: 'all_done',
      }),
    );
    expect(r.kind).toBe('milestone-uat-recovery');
    expect(r.phase).toBe('03');
  });

  it('priority 6: phase_count=0 → scope', () => {
    const r = routeFromState(baseState({ phase_count: 0, next_phase_state: 'phase_count_zero' }));
    expect(r.kind).toBe('scope');
  });

  it('priority 7: needs_verification → verify with qa_pending=true when status is pending', () => {
    const r = routeFromState(
      baseState({
        next_phase_state: 'needs_verification',
        qa_status: 'pending',
        qa_reason: 'missing_verification_artifact',
      }),
    );
    expect(r.kind).toBe('verify');
    if (r.kind === 'verify') {
      expect(r.qa_pending).toBe(true);
      expect(r.qa_pending_reason).toBe('missing_verification_artifact');
    }
  });

  it('priority 7: needs_verification → verify with qa_pending=false when status is passed', () => {
    const r = routeFromState(
      baseState({ next_phase_state: 'needs_verification', qa_status: 'passed' }),
    );
    expect(r.kind).toBe('verify');
    if (r.kind === 'verify') expect(r.qa_pending).toBe(false);
  });

  it('priority 8: needs_discussion → discuss', () => {
    const r = routeFromState(baseState({ next_phase_state: 'needs_discussion' }));
    expect(r.kind).toBe('discuss');
  });

  it('priority 9: needs_plan_and_execute → plan-and-execute', () => {
    const r = routeFromState(baseState({ next_phase_state: 'needs_plan_and_execute' }));
    expect(r.kind).toBe('plan-and-execute');
  });

  it('priority 10: needs_execute → execute', () => {
    const r = routeFromState(baseState({ next_phase_state: 'needs_execute' }));
    expect(r.kind).toBe('execute');
  });

  it('priority 11: all_done → archive when no QA attention', () => {
    const r = routeFromState(baseState({ next_phase_state: 'all_done' }));
    expect(r.kind).toBe('archive');
  });

  it('all_done QA-attention fallback → verify when qa_attention_status=pending', () => {
    const r = routeFromState(
      baseState({
        next_phase_state: 'all_done',
        first_qa_attention_phase: '02',
        first_qa_attention_slug: '02-bar',
        qa_attention_status: 'pending',
        qa_attention_reason: 'missing_verification_artifact',
      }),
    );
    expect(r.kind).toBe('verify');
    expect(r.phase).toBe('02');
    if (r.kind === 'verify') {
      expect(r.qa_pending).toBe(true);
      expect(r.qa_pending_reason).toBe('missing_verification_artifact');
    }
    expect(r.reason).toContain('all_done QA attention');
  });

  it('earlier-work QA-attention fallback → qa-remediation when status=failed', () => {
    const r = routeFromState(
      baseState({
        next_phase_state: 'needs_plan_and_execute',
        first_qa_attention_phase: '01',
        first_qa_attention_slug: '01-foo',
        qa_attention_status: 'failed',
      }),
    );
    expect(r.kind).toBe('qa-remediation');
    expect(r.phase).toBe('01');
    expect(r.reason).toContain('earlier-work QA attention');
  });

  it('UAT remediation requires_confirmation honours auto_uat', () => {
    const r1 = routeFromState(
      baseState({ next_phase_state: 'needs_uat_remediation', config_auto_uat: false }),
    );
    expect(r1.requires_confirmation).toBe(true);
    const r2 = routeFromState(
      baseState({ next_phase_state: 'needs_uat_remediation', config_auto_uat: true }),
    );
    expect(r2.requires_confirmation).toBe(false);
  });
});
