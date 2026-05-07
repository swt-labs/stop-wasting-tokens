import type { PhaseDetectResult } from '@swt-labs/methodology';
import { describe, expect, it } from 'vitest';

import { computeWatchState, type WatchSnapshot } from '../../src/watch/state.js';

const baseSnapshot: PhaseDetectResult = {
  jq_available: true,
  planning_dir_exists: true,
  project_exists: true,
  phases_dir: '.swt-planning/phases',
  has_shipped_milestones: true,
  needs_milestone_rename: false,
  phase_count: 5,
  next_phase: '04',
  next_phase_slug: '04-user-surfaces',
  next_phase_state: 'needs_plan_and_execute',
  next_phase_plans: 3,
  next_phase_summaries: 0,
  has_unverified_phases: false,
  first_unverified_phase: undefined,
  first_unverified_slug: undefined,
  first_qa_attention_phase: undefined,
  first_qa_attention_slug: undefined,
  qa_attention_status: 'none',
  qa_attention_reason: 'none',
  qa_status: 'none',
  qa_reason: 'none',
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
  config_effort: 'thorough',
  config_autonomy: 'pure-vibe',
  config_auto_commit: true,
  config_planning_tracking: 'manual',
  config_auto_push: 'never',
  config_verification_tier: 'standard',
  config_prefer_teams: 'auto',
  config_max_tasks_per_plan: 5,
  config_context_compiler: true,
  config_require_phase_discussion: false,
  config_auto_uat: true,
  config_compaction_threshold: 130000,
} as PhaseDetectResult;

describe('computeWatchState', () => {
  it('happy path: full snapshot populates all view-model fields', () => {
    const snapshot: WatchSnapshot = {
      phaseDetect: baseSnapshot,
      recentActivity: [
        { hash: 'abc1234', subject: 'commit one', date: '2026-05-07T10:00:00Z' },
        { hash: 'def5678', subject: 'commit two', date: '2026-05-07T10:05:00Z' },
      ],
      project: 'stop-wasting-tokens',
      milestone: 'v1.5',
    };

    const vm = computeWatchState(snapshot);

    expect(vm.project).toBe('stop-wasting-tokens');
    expect(vm.milestone).toBe('v1.5');
    expect(vm.phase).toEqual({
      number: '04',
      slug: '04-user-surfaces',
      state: 'needs_plan_and_execute',
    });
    expect(vm.plans).toEqual({ summaries: 0, total: 3 });
    expect(vm.qa).toEqual({ status: 'none' });
    expect(vm.uat.issues).toBe(0);
    expect(vm.uat.file).toBeUndefined();
    expect(vm.activity).toHaveLength(2);
  });

  it('phase_count=0 yields pending state and empty phase number/slug', () => {
    const snapshot: WatchSnapshot = {
      phaseDetect: {
        ...baseSnapshot,
        phase_count: 0,
        next_phase: undefined,
        next_phase_slug: undefined,
        next_phase_state: 'phase_count_zero',
        next_phase_plans: 0,
        next_phase_summaries: 0,
      },
      recentActivity: [],
      project: 'fresh',
      milestone: '',
    };

    const vm = computeWatchState(snapshot);

    expect(vm.phase.number).toBe('');
    expect(vm.phase.slug).toBe('');
    expect(vm.phase.state).toBe('pending');
  });

  it('UAT issues present surfaces in uat.issues + uat.file', () => {
    const snapshot: WatchSnapshot = {
      phaseDetect: {
        ...baseSnapshot,
        uat_issues_count: 3,
        uat_file: '04-UAT.md',
      },
      recentActivity: [],
      project: 'p',
      milestone: 'm',
    };

    const vm = computeWatchState(snapshot);

    expect(vm.uat.issues).toBe(3);
    expect(vm.uat.file).toBe('04-UAT.md');
  });

  it('QA in remediation populates round number', () => {
    const snapshot: WatchSnapshot = {
      phaseDetect: {
        ...baseSnapshot,
        qa_status: 'remediating',
        qa_round: '02',
      },
      recentActivity: [],
      project: 'p',
      milestone: 'm',
    };

    const vm = computeWatchState(snapshot);

    expect(vm.qa).toEqual({ status: 'remediating', round: '02' });
  });

  it('recentActivity empty surfaces as empty array (not undefined)', () => {
    const snapshot: WatchSnapshot = {
      phaseDetect: baseSnapshot,
      recentActivity: [],
      project: 'p',
      milestone: 'm',
    };

    const vm = computeWatchState(snapshot);

    expect(vm.activity).toEqual([]);
    expect(Array.isArray(vm.activity)).toBe(true);
  });
});
