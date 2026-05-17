/**
 * Vendor-neutral types shared across runtime, orchestration, methodology,
 * dashboard, and cli.
 *
 * Migrated in PR-04 from:
 *   - runtime/src/types.ts → session.ts, event union in session.ts
 *   - runtime/src/meter-types.ts → meter.ts
 *   - orchestration/src/types.ts → dispatcher.ts
 *   - core/src/types/{agent-role,autonomy,effort,verification}.ts → here (copies)
 * New in PR-04:
 *   - thinking-level.ts (Pi's ThinkingLevel vocabulary; per TDD2 §7.1.1)
 *
 * `core/src/types/index.ts` keeps a re-export shim so existing
 * `from '@swt-labs/core'` imports in methodology / cli continue to resolve
 * unchanged. The shim runs one minor cycle (v3.0.x) and is deleted in v3.1.0.
 */

export * from './session.js';
export * from './meter.js';
export * from './dispatcher.js';
export * from './agent-role.js';
export * from './autonomy.js';
export * from './effort.js';
export * from './verification.js';
export * from './thinking-level.js';
export * from './agent-spec.js';
export * from './worktree.js';
export * from './dag.js';
// Plan 01-05 (Phase 1) — swt:askUser IPC payload types (prompt.request /
// prompt.response). The canonical Zod union still lives in schemas/events.ts;
// this module surfaces the two new variants by name for ergonomic imports.
export * from './snapshot-event.js';
// Phase 2 / Plan 02-01 (G-R3) — RateCard + RateCardEntry Zod schemas + types.
// Pure schema module (no IO); consumed by `@swt-labs/runtime` budget loader
// (plan 02-01) and the upcoming `cost-optimized-rate-card` strategy in
// `@swt-labs/orchestration` (plan 02-02).
export * from './rate-card.js';
// Milestone 13 / Phase 01 — Unified-log discriminated union consumed by the
// dashboard's UnifiedLogPanel + dashboard-store reducers. Schema-only (zod);
// L7 dashboard imports `LogEntry` via `import type`.
export * from './log-entry.js';
// Statusline-extension milestone — per-model context-window lookup
// (`getContextWindow` + `KNOWN_MODEL_IDS`). Pure data table at L0; consumed
// by the dashboard statusline's `ctx ~Xk/Yk` cell. Runtime + orchestration
// can pick it up later if a use case shows up.
export * from './model-info.js';
