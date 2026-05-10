import { detectPhase, type PhaseDetectResult } from '@swt-labs/methodology';
import type { DetectPhaseReport } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

/**
 * Registers `GET /api/detect-phase`. Mirrors the CLI's `swt detect-phase`
 * (default JSON mode) — runs the phase-detector once per request and wraps
 * the result in a thin envelope so the dashboard panel can branch on
 * `is_initialized` without poking at the inner `PhaseDetectResult` shape.
 *
 * Why per-request rather than at-registration like the brownfield flag:
 * detect-phase output changes over a daemon's lifetime (new commits, new
 * SUMMARY.md files, UAT round transitions). The detector is fast — single
 * fs walk + a few git invocations gated by `allowGit` — so a 60 s
 * client-side refresh isn't a hot path.
 *
 * Errors thrown from the detector (corrupt STATE.md, permission issues)
 * surface as 500 with a typed envelope rather than crashing the route.
 */
export function registerDetectPhaseRoute(app: Hono, cwd: string): void {
  app.get('/api/detect-phase', async (c) => {
    let result: PhaseDetectResult;
    try {
      result = await detectPhase({ cwd });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'detect_phase_failed', detail: message }, 500);
    }
    const response: DetectPhaseReport = {
      result,
      // `project_exists` is the canonical "this daemon has something to
      // show" signal — matches how Snapshot.is_initialized is derived
      // elsewhere in the dashboard.
      is_initialized: result.project_exists,
      generated_at: new Date().toISOString(),
    };
    return c.json(response);
  });
}
