/**
 * `AgentSpawner` — backend-specific spawn abstraction.
 *
 * `AgentSpec` migrated to `@swt-labs/shared` in M2 PR-12 (the
 * `CodexReasoningEffort → ThinkingLevel` cascade rename). Re-exported from
 * here for one-cycle compat; v3.1 drops the re-export and consumers import
 * from `@swt-labs/shared` directly.
 */

import type { AgentSpec } from '@swt-labs/shared';

import type { AgentRole } from '../types/index.js';

export type { AgentSpec } from '@swt-labs/shared';

export interface SpawnRequest {
  readonly spec: AgentSpec;
  readonly prompt: string;
  readonly cwd: string;
  readonly session_id: string;
  /** Optional structured input attached to the prompt. */
  readonly input?: Readonly<Record<string, unknown>>;
}

export interface SpawnResult {
  readonly role: AgentRole;
  readonly success: boolean;
  /** Final text output from the agent (if any). */
  readonly text?: string;
  /** Parsed structured handoff envelope if the agent emitted one. */
  readonly handoff?: Readonly<Record<string, unknown>>;
  /** Token usage when reported by the backend. */
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
  /** Backend-side error if `success === false`. */
  readonly error?: string;
}

/**
 * Turns a methodology role into a backend-specific spawn. v3's
 * `PiSpawnerEnvironment` is the canonical implementation (via
 * `@swt-labs/orchestration`'s dispatcher); legacy backends used codex/etc.
 */
export interface AgentSpawner {
  installAgent(spec: AgentSpec): Promise<void>;
  spawn(request: SpawnRequest): Promise<SpawnResult>;
  /** Tear down any backend resources allocated for this agent. */
  removeAgent(role: AgentRole): Promise<void>;
}
