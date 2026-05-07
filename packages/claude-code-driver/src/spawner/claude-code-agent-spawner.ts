import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentRole, AgentSpawner, AgentSpec, SpawnRequest, SpawnResult } from '@swt-labs/core';

import { spawnClaude } from '../spawn/wrapper.js';

export interface ClaudeCodeAgentSpawnerOptions {
  /** Override `~/.claude` (or `$CLAUDE_CONFIG_DIR`). Useful for tests. */
  readonly claude_config_dir?: string;
  /** Override the `claude` binary path (default: PATH lookup). */
  readonly bin?: string;
  /** Override env passed to `claude --print`. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Concrete AgentSpawner backed by the Claude Code CLI:
 *
 * - `installAgent(spec)` writes the role's JSON profile to
 *   `${claude_config_dir}/agents/${role}.json` (atomic via tmp+rename).
 * - `spawn(request)` delegates to `spawnClaude` which shells out to
 *   `claude --print --output-format stream-json`.
 * - `removeAgent(role)` unlinks the profile (idempotent — ENOENT is a no-op).
 */
export class ClaudeCodeAgentSpawner implements AgentSpawner {
  readonly #claude_config_dir: string;
  readonly #bin: string;
  readonly #env?: NodeJS.ProcessEnv;

  constructor(opts: ClaudeCodeAgentSpawnerOptions = {}) {
    this.#claude_config_dir =
      opts.claude_config_dir ?? process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
    this.#bin = opts.bin ?? 'claude';
    if (opts.env !== undefined) this.#env = opts.env;
  }

  async installAgent(spec: AgentSpec): Promise<void> {
    const agentsDir = join(this.#claude_config_dir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    const target = join(agentsDir, `${spec.role}.json`);
    const tmp = `${target}.tmp.${randomBytes(8).toString('hex')}`;
    const profile = {
      description: `SWT ${spec.role} agent profile`,
      prompt: spec.developer_instructions,
      model: spec.model,
      tools: spec.allowed_mcp_servers,
      ...(spec.sandbox_mode !== undefined ? { sandbox_mode: spec.sandbox_mode } : {}),
      ...(spec.max_turns !== undefined ? { max_turns: spec.max_turns } : {}),
    };
    await writeFile(tmp, JSON.stringify(profile, null, 2), { encoding: 'utf8', mode: 0o644 });
    await rename(tmp, target);
  }

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    return spawnClaude(request, {
      bin: this.#bin,
      ...(this.#env !== undefined ? { env: this.#env } : {}),
    });
  }

  async removeAgent(role: AgentRole): Promise<void> {
    const target = join(this.#claude_config_dir, 'agents', `${role}.json`);
    try {
      await unlink(target);
    } catch (err) {
      if (typeof err !== 'object' || err === null || (err as { code?: string }).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
