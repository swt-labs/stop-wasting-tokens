import type { Snapshot } from '@swt-labs/shared';

/**
 * Synthetic snapshot for greenfield daemons (no `.swt-planning/` in cwd or
 * any ancestor). Lets the SPA branch on `is_initialized: false` and render
 * the InitScreen instead of failing to bootstrap with a misleading
 * DISCONNECTED indicator.
 *
 * When `brownfield` is true, the dashboard's InitScreen renders a
 * brownfield-aware variant ("set up SWT around your existing codebase")
 * instead of the pure-greenfield "name a fresh project" variant. The
 * caller (registerSnapshotRoute) computes this once at registration via
 * `detectBrownfield(cwd)` and passes the result through.
 */
export function emptySnapshot(brownfield = false): Snapshot {
  return {
    schema_version: '1',
    generated_at: new Date().toISOString(),
    project: null,
    milestone: null,
    phases: [],
    active_agents: [],
    recent_events: [],
    cost_summary: null,
    is_initialized: false,
    brownfield_detected: brownfield,
    // Milestone 23 Phase 03 PA-3 — set the NEW `brownfield` field alongside
    // the existing `brownfield_detected` so the pre-init snapshot carries
    // both consistently. App.tsx continues to read `brownfield_detected`
    // for the pre-init InitScreen gate; `CodebaseMapPrompt` reads the new
    // `brownfield` field — but only when `is_initialized === true`, so
    // the value here is effectively informational for the pre-init shape.
    brownfield: brownfield,
  };
}
