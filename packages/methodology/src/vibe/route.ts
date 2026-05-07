import type { PhaseDetectResult } from '../state/types.js';

export interface RouteArgs {
  /** --plan: target a specific phase by 2-digit position. */
  readonly phase?: string;
  readonly mode?:
    | 'plan'
    | 'execute'
    | 'discuss'
    | 'assumptions'
    | 'scope'
    | 'add'
    | 'insert'
    | 'remove'
    | 'verify'
    | 'archive';
  readonly yolo?: boolean;
  readonly skipQa?: boolean;
  readonly skipAudit?: boolean;
  readonly effort?: 'thorough' | 'balanced' | 'fast' | 'turbo';
}

export interface VibeRouteBase {
  /** Phase this route targets (when relevant). */
  readonly phase?: string;
  /** Phase slug (when relevant). */
  readonly phase_slug?: string;
  /** True when the matched route requires user confirmation before execution. */
  readonly requires_confirmation: boolean;
  /** Optional reason populated when the routing decision needs explanation. */
  readonly reason?: string;
}

export type VibeRoute =
  | (VibeRouteBase & { kind: 'init-redirect' })
  | (VibeRouteBase & { kind: 'bootstrap' })
  | (VibeRouteBase & { kind: 'scope' })
  | (VibeRouteBase & { kind: 'discuss' })
  | (VibeRouteBase & { kind: 'plan-and-execute' })
  | (VibeRouteBase & { kind: 'execute' })
  | (VibeRouteBase & {
      kind: 'verify';
      qa_pending: boolean;
      qa_pending_reason: string | undefined;
    })
  | (VibeRouteBase & { kind: 'qa-remediation' })
  | (VibeRouteBase & { kind: 'uat-remediation' })
  | (VibeRouteBase & { kind: 're-verify' })
  | (VibeRouteBase & { kind: 'milestone-uat-recovery' })
  | (VibeRouteBase & { kind: 'archive' })
  | (VibeRouteBase & { kind: 'all-done' });

/**
 * Priority routing implementing VBW vibe.md tables 1-11 plus the
 * all_done QA-attention fallback and the earlier-work QA-attention fallback.
 */
export function routeFromState(state: PhaseDetectResult, _args: RouteArgs = {}): VibeRoute {
  // Priority 1
  if (!state.planning_dir_exists) {
    return { kind: 'init-redirect', requires_confirmation: false };
  }
  // Priority 2
  if (!state.project_exists) {
    return { kind: 'bootstrap', requires_confirmation: true };
  }
  // Priority 3 — UAT remediation
  if (state.next_phase_state === 'needs_uat_remediation') {
    return {
      kind: 'uat-remediation',
      phase: state.next_phase,
      phase_slug: state.next_phase_slug,
      requires_confirmation: !state.config_auto_uat,
    };
  }
  // Priority 3.5 — QA remediation
  if (state.next_phase_state === 'needs_qa_remediation') {
    return {
      kind: 'qa-remediation',
      phase: state.next_phase,
      phase_slug: state.next_phase_slug,
      requires_confirmation: !state.config_auto_uat,
    };
  }
  // Priority 4 — Re-verify
  if (state.next_phase_state === 'needs_reverification') {
    return {
      kind: 're-verify',
      phase: state.next_phase,
      phase_slug: state.next_phase_slug,
      requires_confirmation: !state.config_auto_uat,
    };
  }
  // Priority 5 — Milestone UAT recovery
  if (state.milestone_uat_issues) {
    return {
      kind: 'milestone-uat-recovery',
      phase: state.milestone_uat_phase === 'none' ? undefined : state.milestone_uat_phase,
      phase_slug: state.milestone_uat_slug === 'none' ? undefined : state.milestone_uat_slug,
      // Mode handles its own confirmation per VBW spec.
      requires_confirmation: false,
    };
  }
  // Priority 6 — Scope
  if (state.phase_count === 0 || state.next_phase_state === 'phase_count_zero') {
    return { kind: 'scope', requires_confirmation: true };
  }

  // Earlier-work QA-attention fallback (failed) — fires before priorities 7-11
  // when first_qa_attention is set with status=failed and the routing state is
  // earlier-work (needs_discussion/needs_plan_and_execute/needs_execute).
  if (
    state.first_qa_attention_phase !== undefined &&
    state.qa_attention_status === 'failed' &&
    (state.next_phase_state === 'needs_discussion' ||
      state.next_phase_state === 'needs_plan_and_execute' ||
      state.next_phase_state === 'needs_execute')
  ) {
    return {
      kind: 'qa-remediation',
      phase: state.first_qa_attention_phase,
      phase_slug: state.first_qa_attention_slug,
      requires_confirmation: !state.config_auto_uat,
      reason: 'earlier-work QA attention fallback',
    };
  }

  // Priority 7 — Verify
  if (state.next_phase_state === 'needs_verification') {
    return {
      kind: 'verify',
      phase: state.next_phase,
      phase_slug: state.next_phase_slug,
      qa_pending: state.qa_status === 'pending',
      qa_pending_reason:
        state.qa_reason === 'none' || state.qa_reason.length === 0
          ? state.qa_attention_reason === 'none'
            ? undefined
            : state.qa_attention_reason
          : state.qa_reason,
      requires_confirmation: false,
    };
  }
  // Priority 8 — Discuss
  if (state.next_phase_state === 'needs_discussion') {
    return {
      kind: 'discuss',
      phase: state.next_phase,
      phase_slug: state.next_phase_slug,
      requires_confirmation: true,
    };
  }
  // Priority 9 — Plan + Execute
  if (state.next_phase_state === 'needs_plan_and_execute') {
    return {
      kind: 'plan-and-execute',
      phase: state.next_phase,
      phase_slug: state.next_phase_slug,
      requires_confirmation: true,
    };
  }
  // Priority 10 — Execute
  if (state.next_phase_state === 'needs_execute') {
    return {
      kind: 'execute',
      phase: state.next_phase,
      phase_slug: state.next_phase_slug,
      requires_confirmation: true,
    };
  }
  // Priority 11 — Archive (with QA-attention fallback to verify)
  if (state.next_phase_state === 'all_done') {
    if (state.first_qa_attention_phase !== undefined && state.qa_attention_status === 'pending') {
      return {
        kind: 'verify',
        phase: state.first_qa_attention_phase,
        phase_slug: state.first_qa_attention_slug,
        qa_pending: true,
        qa_pending_reason:
          state.qa_attention_reason === 'none' ? undefined : state.qa_attention_reason,
        requires_confirmation: false,
        reason: 'all_done QA attention fallback',
      };
    }
    return { kind: 'archive', requires_confirmation: true };
  }

  return { kind: 'all-done', requires_confirmation: false };
}
