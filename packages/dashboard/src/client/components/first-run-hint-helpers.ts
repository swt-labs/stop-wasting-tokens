/**
 * Plan 04-01 (milestone 12, Phase 04) — pure helpers for `FirstRunHint`.
 *
 * Why a separate module?
 *   Same constraint as Phase 03's `chat-panel-helpers`: the dashboard
 *   vitest harness runs `environment: 'node'` with an esbuild transform
 *   that cannot emit Solid-compatible JSX runtime calls, so component
 *   render-tests are out of scope. The load-bearing decisions — when the
 *   hint should be visible, what localStorage key it persists under, and
 *   what shape the dismissed signal takes — are factored into these pure
 *   helpers and unit-tested directly.
 *
 * The component (FirstRunHint.tsx) owns the localStorage side effects;
 * the helpers themselves are pure functions of their inputs (no DOM, no
 * globals, no I/O), which keeps the test suite free of `globalThis`
 * mocks.
 */
import type { DashboardState } from '../state/dashboard-store.js';

/**
 * Visibility predicate for the first-run hint banner. Returns true ONLY
 * when:
 *   - the dashboard is fully initialized (snapshot.is_initialized === true)
 *   - no chat session is in flight (state.chatSession === null)
 *   - no vibe / cook session is in flight (state.vibeSession === null)
 *   - the user has not yet dismissed the hint this mount
 *     (dismissed === false)
 *
 * The session-null checks double as the "auto-hide on first submit"
 * mechanism: the moment `startChat()` or `startVibeSession()` adopts an
 * id, the predicate flips false and the banner unmounts on the next
 * render. The component layers explicit localStorage persistence on top
 * of this via the close button (and optionally a first-submit effect —
 * see FirstRunHint.tsx for the chosen variant).
 */
export function shouldShowHint(state: DashboardState, dismissed: boolean): boolean {
  return (
    state.snapshot?.is_initialized === true &&
    state.chatSession === null &&
    state.vibeSession === null &&
    dismissed === false
  );
}

/**
 * Project-scoped localStorage key prefix. Different SWT-init'd
 * directories each get their own first-run hint state so dismissing the
 * hint in project A does NOT also dismiss it in project B (each browser
 * profile typically opens many SWT projects across its lifetime; the
 * onboarding hint should re-introduce itself per-project).
 */
export const FIRST_RUN_HINT_STORAGE_PREFIX = 'swt-dashboard-first-run-hint-dismissed:';

/**
 * Derive the localStorage key for a given project root. Pure function —
 * the component reads/writes localStorage with the result.
 */
export function firstRunHintStorageKey(projectRoot: string): string {
  return `${FIRST_RUN_HINT_STORAGE_PREFIX}${projectRoot}`;
}

/**
 * Reasons a user can dismiss the first-run hint. Future telemetry may
 * branch on dismissal cause; v1 keeps the field internal to the
 * component's signal.
 */
export type DismissReason = 'submit-chat' | 'submit-cook' | 'close-button';

/**
 * Shape of the dismissed signal after the reducer runs. `dismissed` is
 * always `true` on a dismissReducer call — the reducer is only invoked
 * when the user has actively triggered dismissal (close button or first
 * submit).
 */
export interface DismissState {
  readonly dismissed: true;
  readonly reason: DismissReason;
}

/**
 * Shape-stable reducer for the dismissed signal. Returns the next state
 * given the previous shape and the reason that fired dismissal. The
 * previous state is accepted for symmetry with reducer conventions
 * (future-proofing if dismissal becomes path-dependent); v1 ignores it
 * because dismissal is monotonic — once dismissed, always dismissed for
 * the rest of the session.
 */
export function dismissReducer(_prev: { dismissed: boolean }, reason: DismissReason): DismissState {
  return { dismissed: true, reason };
}
