/**
 * v3.0.x compat shim. PR-04 moved the vendor-neutral type definitions
 * (AgentRole, Autonomy, Effort, VerificationTier) from this directory to
 * `@swt-labs/shared`. M2 PR-12 added `AgentSpec` (renamed from
 * `reasoning_effort: CodexReasoningEffort` to `thinking_level: ThinkingLevel`)
 * and deleted `codex-reasoning-effort.ts`. This file re-exports the canonical
 * shared definitions so existing consumers that
 * `import type { AgentRole } from '@swt-labs/core'` keep resolving without
 * changes for one minor cycle.
 *
 * Deletion target: v3.1.0.
 */
export * from '@swt-labs/shared';
