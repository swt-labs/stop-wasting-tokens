import type {
  AgentRole,
  AgentSpawner,
  AgentSpec,
  SpawnRequest,
  SpawnResult,
} from '@swt-labs/core';

import { applySandboxToPrompt } from '../sandbox/wrapper.js';
import { spawnOllama, OLLAMA_HOST_DEFAULT, type SpawnFlags } from '../spawn/wrapper.js';

export interface OllamaAgentSpawnerOptions {
  /** Override Ollama base URL (default $OLLAMA_HOST or http://localhost:11434). */
  readonly ollama_host?: string;
  /** Override the fetch implementation (useful for tests). */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Concrete AgentSpawner backed by Ollama's local HTTP API. Ollama has no
 * persistent agent-profile concept (agent context is sent per-request),
 * so installAgent stores the spec in an in-memory registry. Subsequent
 * spawn() calls look up the registered spec when a request omits it
 * (or reinforces it when both are present).
 */
export class OllamaAgentSpawner implements AgentSpawner {
  readonly #ollama_host: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #installed: Map<AgentRole, AgentSpec> = new Map();

  constructor(opts: OllamaAgentSpawnerOptions = {}) {
    this.#ollama_host = opts.ollama_host ?? process.env['OLLAMA_HOST'] ?? OLLAMA_HOST_DEFAULT;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  installAgent(spec: AgentSpec): Promise<void> {
    this.#installed.set(spec.role, spec);
    return Promise.resolve();
  }

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    const installed = this.#installed.get(request.spec.role);
    const effectiveSpec = installed ?? request.spec;
    const effectiveRequest: SpawnRequest =
      installed !== undefined ? { ...request, spec: installed } : request;
    const wrappedSystemPrompt = applySandboxToPrompt(
      effectiveSpec.developer_instructions,
      effectiveSpec.sandbox_mode,
      request.cwd,
    );
    const flags: SpawnFlags = {
      ollama_host: this.#ollama_host,
      fetch: this.#fetch,
      system_prompt_override: wrappedSystemPrompt,
    };
    return spawnOllama(effectiveRequest, flags);
  }

  removeAgent(role: AgentRole): Promise<void> {
    this.#installed.delete(role);
    return Promise.resolve();
  }

  /** Test seam: report which roles are currently installed. */
  installedRoles(): readonly AgentRole[] {
    return Array.from(this.#installed.keys());
  }
}
