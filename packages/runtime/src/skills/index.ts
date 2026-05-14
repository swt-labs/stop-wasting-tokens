/**
 * Plan 01-04 (Phase 1) — public skill-reader surface.
 *
 * Re-exports `invokeSkill` + `resolveSkillPath` for `@swt-labs/runtime`
 * consumers. The Pi custom-tool registration (`swt_invoke_skill`) that
 * bridges this reader to spawned agent sessions lives in
 * `packages/orchestration/src/spawn-agent.ts` (plan 01-01), NOT here.
 */

export { invokeSkill, resolveSkillPath, type InvokeSkillOptions } from './invoke-skill.js';
