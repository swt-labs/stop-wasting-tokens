import type {
  AgentRole,
  AgentSpawner,
  AgentSpec,
  SpawnRequest,
  SpawnResult,
} from '@swt-labs/core';

const NOT_IMPLEMENTED =
  '@swt-labs/claude-code-driver: not implemented in v1.0; lands in v1.5 — track docs/v1-5-roadmap';

export class ClaudeCodeAgentSpawner implements AgentSpawner {
  async installAgent(_spec: AgentSpec): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async spawn(_request: SpawnRequest): Promise<SpawnResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async removeAgent(_role: AgentRole): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

export const PACKAGE_NAME = '@swt-labs/claude-code-driver';
export const VERSION = '0.0.0';
export const STATUS = 'stub';
