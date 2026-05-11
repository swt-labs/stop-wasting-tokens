/**
 * v3.0.x compat shim. PR-04 moved the vendor-neutral type definitions
 * (AgentRole, Autonomy, Effort, VerificationTier) from this directory to
 * `@swt-labs/shared`. This file re-exports them so existing consumers that
 * `import type { AgentRole } from '@swt-labs/core'` keep resolving without
 * changes for one minor cycle.
 *
 * `codex-reasoning-effort.ts` stays put — it's still threaded through
 * `AgentSpec.reasoning_effort` (in `core/src/abstractions/AgentSpawner.ts`)
 * and `methodology/src/vibe/orchestration/agent-spec-resolver.ts`. M2 PR-12+
 * renames the field to `thinking_level: ThinkingLevel` (Pi vocabulary) and
 * drops this file in the same change.
 *
 * Deletion target: v3.1.0.
 */
export * from '@swt-labs/shared';
export * from './codex-reasoning-effort.js';
