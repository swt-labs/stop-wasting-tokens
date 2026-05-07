import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import TOML from '@iarna/toml';

import {
  type AgentRole,
  type AgentSpec,
  ConfigError,
  type Effort,
  EFFORTS,
  isAgentRole,
  type SwtConfig,
} from '@swt-labs/core';

export interface AgentSpecResolverOptions {
  readonly role: AgentRole;
  readonly config: SwtConfig;
  /** Filesystem path or file:// URL to the directory containing `${role}.toml` files. */
  readonly templates_dir: string | URL;
}

interface RawTemplate {
  readonly role?: unknown;
  readonly model?: unknown;
  readonly model_reasoning_effort?: unknown;
  readonly developer_instructions?: unknown;
  readonly allowed_mcp_servers?: unknown;
  readonly sandbox_mode?: unknown;
  readonly max_turns?: unknown;
}

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
type SandboxMode = (typeof SANDBOX_MODES)[number];

const FALLBACK_MODEL = 'default';

/**
 * Resolves an AgentSpec from the bundled agents-templates + config overrides.
 *
 * **Cross-backend model gap (v1.5):** the resolved `model` value is treated
 * literally by the active backend. The bundled agents-templates declare
 * Codex-specific identifiers like `gpt-5-codex`, which Codex interprets but
 * Claude Code and Ollama do not. Users on non-Codex backends MUST set
 * `config.model_overrides[role]` to a backend-appropriate value:
 *
 *   - `backend=claude-code`: a Claude alias (`sonnet`, `opus`, `haiku`) or a
 *     full model id (`claude-sonnet-4-6`).
 *   - `backend=ollama`: a local Ollama model name (`llama3.2`, `qwen2.5`,
 *     `mistral`).
 *
 * The resolver itself is backend-agnostic — `model_overrides` is the single
 * documented escape hatch. Cross-backend automatic model resolution is a v2
 * concern (would require a backend-keyed override map or per-template
 * model-alias tables; both deferred).
 */
export async function resolveAgentSpec(
  opts: AgentSpecResolverOptions,
): Promise<AgentSpec> {
  const { role, config } = opts;
  const templatesPath =
    opts.templates_dir instanceof URL
      ? fileURLToPath(opts.templates_dir)
      : opts.templates_dir;
  const tomlPath = join(templatesPath, `${role}.toml`);

  let source: string;
  try {
    source = await readFile(tomlPath, 'utf8');
  } catch (cause) {
    throw new ConfigError(`Agent template not found: ${tomlPath}`, { cause });
  }

  let parsed: RawTemplate;
  try {
    parsed = TOML.parse(source) as RawTemplate;
  } catch (cause) {
    throw new ConfigError(`Failed to parse ${tomlPath} as TOML`, { cause });
  }

  if (typeof parsed.role === 'string' && parsed.role !== role) {
    throw new ConfigError(
      `${tomlPath} declares role "${parsed.role}" but resolver was asked for "${role}"`,
    );
  }
  if (parsed.role !== undefined && !isAgentRole(parsed.role)) {
    throw new ConfigError(`${tomlPath} declares an invalid role: ${String(parsed.role)}`);
  }

  const tomlModel = typeof parsed.model === 'string' ? parsed.model : undefined;
  const overrideModel = config.model_overrides[role];
  const model = overrideModel ?? tomlModel ?? FALLBACK_MODEL;

  const reasoning_effort = resolveReasoningEffort(parsed.model_reasoning_effort, tomlPath);

  const developer_instructions =
    typeof parsed.developer_instructions === 'string'
      ? parsed.developer_instructions
      : '';

  const overrideMcp = config.mcp_overrides[role];
  const tomlMcp = parseStringArray(parsed.allowed_mcp_servers, tomlPath, 'allowed_mcp_servers');
  const allowed_mcp_servers = overrideMcp ?? tomlMcp;

  const sandbox_mode = resolveSandboxMode(parsed.sandbox_mode, tomlPath);

  const overrideMaxTurns = config.agent_max_turns[role];
  const tomlMaxTurns =
    typeof parsed.max_turns === 'number' && Number.isInteger(parsed.max_turns) && parsed.max_turns > 0
      ? parsed.max_turns
      : undefined;
  const max_turns = overrideMaxTurns ?? tomlMaxTurns;

  const spec: AgentSpec = {
    role,
    model,
    reasoning_effort,
    developer_instructions,
    allowed_mcp_servers,
    ...(sandbox_mode !== undefined ? { sandbox_mode } : {}),
    ...(max_turns !== undefined ? { max_turns } : {}),
  };

  return spec;
}

/**
 * Locate the bundled agents-templates/ directory for the @swt-labs/methodology
 * package. The templates ship at `packages/methodology/templates/agents/` and
 * are reachable via `import.meta.url` resolution in both the monorepo and
 * once published.
 */
export function getBundledAgentTemplatesDir(): URL {
  return new URL('../../../templates/agents/', import.meta.url);
}

function resolveReasoningEffort(value: unknown, tomlPath: string): Effort {
  if (value === undefined) return 'balanced';
  if (typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)) {
    return value as Effort;
  }
  throw new ConfigError(
    `${tomlPath} has invalid model_reasoning_effort: ${String(value)} (expected one of ${EFFORTS.join(', ')})`,
  );
}

function parseStringArray(value: unknown, tomlPath: string, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ConfigError(`${tomlPath} field ${field} must be an array of strings`);
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new ConfigError(`${tomlPath} field ${field} must contain only strings`);
    }
  }
  return value as readonly string[];
}

function resolveSandboxMode(value: unknown, tomlPath: string): SandboxMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (SANDBOX_MODES as readonly string[]).includes(value)) {
    return value as SandboxMode;
  }
  throw new ConfigError(
    `${tomlPath} has invalid sandbox_mode: ${String(value)} (expected one of ${SANDBOX_MODES.join(', ')})`,
  );
}
