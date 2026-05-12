/**
 * `AgentSpec` — the role-specific configuration the orchestrator hands to a
 * spawner when it dispatches a task. Migrated to `@swt-labs/shared` in M2 PR-12
 * as part of the `CodexReasoningEffort → ThinkingLevel` cascade rename (the
 * carry-forward deferred from M1 Plan 01-01 PR-04).
 *
 * **Field rename:** v2's `reasoning_effort: CodexReasoningEffort` is replaced
 * by `thinking_level: ThinkingLevel`. The Codex-flavoured vocabulary
 * (`minimal | low | medium | high | xhigh`) and the Pi-flavoured vocabulary
 * (`off | minimal | low | medium | high | xhigh`) share most values; the only
 * delta is Pi's `off` (which Codex didn't expose). The role-resolver in
 * `runtime/src/providers/role-resolver.ts` already maps role → ThinkingLevel
 * per TDD2 §10.5; this spec is consumed by the orchestration dispatcher.
 *
 * Per TDD2 §4.3, this type lives at the shared (leaf) layer so methodology,
 * orchestration, runtime, and cli can all reference it without crossing
 * package boundaries.
 */

import type { AgentRole } from './agent-role.js';
import type { ThinkingLevel } from './thinking-level.js';

export interface AgentSpec {
  readonly role: AgentRole;
  readonly model: string;
  readonly thinking_level: ThinkingLevel;
  readonly developer_instructions: string;
  readonly allowed_mcp_servers: readonly string[];
  readonly sandbox_mode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  readonly max_turns?: number;
  /**
   * Optional alternate names the orchestrator may use to route to this role.
   * The dispatcher resolves the first matching alias before falling back to
   * `role`. Empty / undefined = no aliases.
   */
  readonly aliases?: readonly string[];
}
