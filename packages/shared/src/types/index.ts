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
