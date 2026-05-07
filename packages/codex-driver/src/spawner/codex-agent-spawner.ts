import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentRole,
  AgentSpawner,
  AgentSpec,
  SpawnRequest,
  SpawnResult,
} from '@swt-labs/core';

import { spawnCodex } from '../spawn/wrapper.js';
import { emitAgentToml } from '../toml/agents.js';

export interface CodexAgentSpawnerOptions {
  /** Override `~/.codex` (or `$CODEX_HOME`). Useful for tests / custom installs. */
  readonly codex_home?: string;
  /** Override the `codex` binary path (default: PATH lookup). */
  readonly bin?: string;
  /** Override env passed to `codex exec`. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Concrete AgentSpawner backed by the Codex CLI:
 *
 * - `installAgent(spec)` writes the role's TOML profile to
 *   `${codex_home}/agents/${role}.toml` (atomic via tmp+rename so parallel
 *   installs don't tear).
 * - `spawn(request)` delegates to the existing `spawnCodex` low-level wrapper.
 * - `removeAgent(role)` unlinks the profile (idempotent — ENOENT is a no-op).
 *
 * Construction is parameter-free for the common case; tests inject a tmp
 * `codex_home` to keep the user's real Codex install untouched.
 */
export class CodexAgentSpawner implements AgentSpawner {
  readonly #codex_home: string;
  readonly #bin: string;
  readonly #env?: NodeJS.ProcessEnv;

  constructor(opts: CodexAgentSpawnerOptions = {}) {
    this.#codex_home =
      opts.codex_home ?? process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
    this.#bin = opts.bin ?? 'codex';
    if (opts.env !== undefined) this.#env = opts.env;
  }

  async installAgent(spec: AgentSpec): Promise<void> {
    const agentsDir = join(this.#codex_home, 'agents');
    await mkdir(agentsDir, { recursive: true });
    const target = join(agentsDir, `${spec.role}.toml`);
    const tmp = `${target}.tmp.${randomBytes(8).toString('hex')}`;
    await writeFile(tmp, emitAgentToml(spec), { encoding: 'utf8', mode: 0o644 });
    await rename(tmp, target);
  }

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    return spawnCodex(request, {
      bin: this.#bin,
      ...(this.#env !== undefined ? { env: this.#env } : {}),
    });
  }

  async removeAgent(role: AgentRole): Promise<void> {
    const target = join(this.#codex_home, 'agents', `${role}.toml`);
    try {
      await unlink(target);
    } catch (err) {
      if (
        typeof err !== 'object' ||
        err === null ||
        (err as { code?: string }).code !== 'ENOENT'
      ) {
        throw err;
      }
    }
  }
}
