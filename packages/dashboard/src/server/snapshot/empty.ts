import type { Snapshot } from '@swt-labs/dashboard-core';

/**
 * Synthetic snapshot for greenfield daemons (no `.swt-planning/` in cwd or
 * any ancestor). Lets the SPA branch on `is_initialized: false` and render
 * the InitScreen instead of failing to bootstrap with a misleading
 * DISCONNECTED indicator.
 */
export function emptySnapshot(): Snapshot {
  return {
    schema_version: '1',
    generated_at: new Date().toISOString(),
    project: null,
    milestone: null,
    phases: [],
    active_agent: null,
    recent_events: [],
    cost_summary: null,
    is_initialized: false,
  };
}
