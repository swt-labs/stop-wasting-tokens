import type {
  AgentRole,
  AgentSpawner,
  AgentSpec,
  SpawnRequest,
  SpawnResult,
} from '@swt-labs/core';

const NOT_IMPLEMENTED =
  '@swt-labs/ollama-driver: not implemented in v1.0; lands in v1.5 — track docs/v1-5-roadmap';

export class OllamaAgentSpawner implements AgentSpawner {
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

export const PACKAGE_NAME = '@swt-labs/ollama-driver';
export const VERSION = '0.0.0';
export const STATUS = 'stub';
