import type { AgentSpec } from '@swt-labs/core';

import { emitToml, type TomlValue } from './emit.js';

export interface AgentsGlobalConfig {
  /** Maximum concurrent agent threads. Codex caps this at 6 today. */
  readonly max_threads: number;
  /** Maximum nested-spawn depth (orchestrator → child → grandchild …). */
  readonly max_depth: number;
  /** Roles to auto-register in `[agents]`. */
  readonly roles: readonly string[];
}

const DEFAULT_GLOBAL: AgentsGlobalConfig = {
  max_threads: 6,
  max_depth: 1,
  roles: ['scout', 'architect', 'lead', 'dev', 'qa', 'debugger'],
};

export function emitAgentToml(spec: AgentSpec): string {
  const table: Record<string, TomlValue> = {
    role: spec.role,
    model: spec.model,
    model_reasoning_effort: spec.reasoning_effort,
    developer_instructions: spec.developer_instructions,
    allowed_mcp_servers: [...spec.allowed_mcp_servers],
  };
  if (spec.sandbox_mode !== undefined) table.sandbox_mode = spec.sandbox_mode;
  if (spec.max_turns !== undefined) table.max_turns = spec.max_turns;
  return emitToml(table);
}

export function emitAgentsGlobalToml(
  config: Partial<AgentsGlobalConfig> = {},
): string {
  const merged: AgentsGlobalConfig = {
    max_threads: config.max_threads ?? DEFAULT_GLOBAL.max_threads,
    max_depth: config.max_depth ?? DEFAULT_GLOBAL.max_depth,
    roles: config.roles ?? DEFAULT_GLOBAL.roles,
  };
  return emitToml({
    agents: {
      max_threads: merged.max_threads,
      max_depth: merged.max_depth,
      roles: [...merged.roles],
    },
  });
}
