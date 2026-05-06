import type { AgentRole } from '../types/agent-role.js';
import type { Effort } from '../types/effort.js';

export interface AgentSpec {
  readonly role: AgentRole;
  readonly model: string;
  readonly reasoning_effort: Effort;
  readonly developer_instructions: string;
  readonly allowed_mcp_servers: readonly string[];
  readonly sandbox_mode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  readonly max_turns?: number;
}

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
 * Turns a methodology role into a backend-specific spawn. On Codex this writes
 * a TOML agent file and invokes `codex exec`; on other backends it does the
 * equivalent.
 */
export interface AgentSpawner {
  installAgent(spec: AgentSpec): Promise<void>;
  spawn(request: SpawnRequest): Promise<SpawnResult>;
  /** Tear down any backend resources allocated for this agent. */
  removeAgent(role: AgentRole): Promise<void>;
}
