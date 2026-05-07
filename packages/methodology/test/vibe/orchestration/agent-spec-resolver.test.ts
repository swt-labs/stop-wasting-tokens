import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigError, DEFAULT_CONFIG, parseConfig, type SwtConfig } from '@swt-labs/core';

import { resolveAgentSpec } from '../../../src/vibe/orchestration/agent-spec-resolver.js';

let templatesDir: string;

const SCOUT_TEMPLATE = `role = "scout"
model = "gpt-5-codex"
model_reasoning_effort = "balanced"
sandbox_mode = "read-only"
allowed_mcp_servers = ["filesystem"]
max_turns = 15
developer_instructions = """
You are the Scout.
"""
`;

const ARCHITECT_NO_MODEL = `role = "architect"
model_reasoning_effort = "thorough"
sandbox_mode = "read-only"
allowed_mcp_servers = []
max_turns = 30
developer_instructions = """
You are the Architect.
"""
`;

const DEV_TEMPLATE = `role = "dev"
model = "gpt-5-codex"
model_reasoning_effort = "balanced"
sandbox_mode = "workspace-write"
allowed_mcp_servers = ["filesystem", "shell"]
max_turns = 75
developer_instructions = """
You are the Dev.
"""
`;

const MISMATCHED_ROLE = `role = "qa"
model = "gpt-5-codex"
model_reasoning_effort = "balanced"
allowed_mcp_servers = []
developer_instructions = "stub"
`;

beforeEach(async () => {
  templatesDir = await mkdtemp(join(tmpdir(), 'swt-templates-'));
  await writeFile(join(templatesDir, 'scout.toml'), SCOUT_TEMPLATE);
  await writeFile(join(templatesDir, 'architect.toml'), ARCHITECT_NO_MODEL);
  await writeFile(join(templatesDir, 'dev.toml'), DEV_TEMPLATE);
  await writeFile(join(templatesDir, 'lead.toml'), MISMATCHED_ROLE);
});

afterEach(() => {
  // Tmp directories under tmpdir() are cleaned by the OS; explicit rm is a
  // no-op for a small handful of files.
});

describe('resolveAgentSpec', () => {
  it('resolves model from agents-templates when no override', async () => {
    const config: SwtConfig = DEFAULT_CONFIG;
    const spec = await resolveAgentSpec({
      role: 'scout',
      config,
      templates_dir: templatesDir,
    });
    expect(spec.role).toBe('scout');
    expect(spec.model).toBe('gpt-5-codex');
    expect(spec.reasoning_effort).toBe('balanced');
    expect(spec.allowed_mcp_servers).toEqual(['filesystem']);
    expect(spec.sandbox_mode).toBe('read-only');
    expect(spec.max_turns).toBe(15);
  });

  it('resolves model from config.model_overrides[role] when set', async () => {
    const config = parseConfig({
      model_overrides: { scout: 'gpt-5-codex-mini' },
    });
    const spec = await resolveAgentSpec({
      role: 'scout',
      config,
      templates_dir: templatesDir,
    });
    expect(spec.model).toBe('gpt-5-codex-mini');
  });

  it('resolves max_turns from config.agent_max_turns when set', async () => {
    const config = parseConfig({
      agent_max_turns: { dev: 999, scout: 15, qa: 25, architect: 30, debugger: 80, lead: 50 },
    });
    const spec = await resolveAgentSpec({
      role: 'dev',
      config,
      templates_dir: templatesDir,
    });
    expect(spec.max_turns).toBe(999);
  });

  it('resolves allowed_mcp_servers from config.mcp_overrides when set', async () => {
    const config = parseConfig({
      mcp_overrides: { dev: ['filesystem', 'github', 'shell'] },
    });
    const spec = await resolveAgentSpec({
      role: 'dev',
      config,
      templates_dir: templatesDir,
    });
    expect(spec.allowed_mcp_servers).toEqual(['filesystem', 'github', 'shell']);
  });

  it('falls back to "default" model when neither override nor TOML model exists', async () => {
    const spec = await resolveAgentSpec({
      role: 'architect',
      config: DEFAULT_CONFIG,
      templates_dir: templatesDir,
    });
    expect(spec.model).toBe('default');
  });

  it('throws ConfigError when role mismatch between input and TOML', async () => {
    await expect(
      resolveAgentSpec({
        role: 'lead',
        config: DEFAULT_CONFIG,
        templates_dir: templatesDir,
      }),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when template file is missing', async () => {
    await expect(
      resolveAgentSpec({
        role: 'debugger',
        config: DEFAULT_CONFIG,
        templates_dir: templatesDir,
      }),
    ).rejects.toThrow(ConfigError);
  });

  it('cross-backend override path: model_overrides wins over Codex-specific TOML model regardless of which backend will consume it', async () => {
    // Bundled agents-templates declare Codex-specific models (e.g. gpt-5-codex).
    // For non-Codex backends, model_overrides[role] is the documented escape hatch.
    const claudeOverride = parseConfig({
      model_overrides: { dev: 'claude-sonnet-4-6' },
    });
    const ollamaOverride = parseConfig({
      model_overrides: { dev: 'llama3.2' },
    });
    const claudeSpec = await resolveAgentSpec({
      role: 'dev',
      config: claudeOverride,
      templates_dir: templatesDir,
    });
    const ollamaSpec = await resolveAgentSpec({
      role: 'dev',
      config: ollamaOverride,
      templates_dir: templatesDir,
    });
    expect(claudeSpec.model).toBe('claude-sonnet-4-6');
    expect(ollamaSpec.model).toBe('llama3.2');
  });
});
