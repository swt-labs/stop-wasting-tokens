import type { PhaseDetectResult } from '@swt-labs/methodology';

export interface RecentCommit {
  readonly hash: string;
  readonly subject: string;
  readonly date: string;
}

export interface WatchSnapshot {
  readonly phaseDetect: PhaseDetectResult;
  readonly recentActivity: readonly RecentCommit[];
  readonly project: string;
  readonly milestone: string;
}

export interface WatchViewModel {
  readonly project: string;
  readonly milestone: string;
  readonly phase: {
    readonly number: string;
    readonly slug: string;
    readonly state: string;
  };
  readonly plans: {
    readonly summaries: number;
    readonly total: number;
  };
  readonly qa: {
    readonly status: string;
    readonly round?: string;
  };
  readonly uat: {
    readonly file?: string;
    readonly issues: number;
  };
  readonly activity: readonly RecentCommit[];
}

/**
 * Pure function: project a phase-detect snapshot + recent commit log into the
 * dashboard view model. Same input → same output, always.
 */
export function computeWatchState(snapshot: WatchSnapshot): WatchViewModel {
  const pd = snapshot.phaseDetect;

  const phaseNumber = pd.next_phase ?? '';
  const phaseSlug = pd.next_phase_slug ?? '';
  const phaseState = pd.phase_count === 0 ? 'pending' : pd.next_phase_state;

  const qa: WatchViewModel['qa'] =
    pd.qa_round !== '00' ? { status: pd.qa_status, round: pd.qa_round } : { status: pd.qa_status };

  const uat: WatchViewModel['uat'] =
    pd.uat_file !== '' && pd.uat_file !== 'none'
      ? { file: pd.uat_file, issues: pd.uat_issues_count }
      : { issues: pd.uat_issues_count };

  return {
    project: snapshot.project,
    milestone: snapshot.milestone,
    phase: { number: phaseNumber, slug: phaseSlug, state: phaseState },
    plans: { summaries: pd.next_phase_summaries, total: pd.next_phase_plans },
    qa,
    uat,
    activity: snapshot.recentActivity,
  };
}
