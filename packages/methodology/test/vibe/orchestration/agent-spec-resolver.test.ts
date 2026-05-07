import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODEX_REASONING_EFFORTS,
  ConfigError,
  DEFAULT_CONFIG,
  parseConfig,
  type AgentRole,
  type SwtConfig,
} from '@swt-labs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getBundledAgentTemplatesDir,
  resolveAgentSpec,
} from '../../../src/vibe/orchestration/agent-spec-resolver.js';

let templatesDir: string;

const SCOUT_TEMPLATE = `name = "scout"
description = "Read-only research agent."
role = "scout"
model = "gpt-5.5"
model_reasoning_effort = "low"
sandbox_mode = "read-only"
allowed_mcp_servers = ["filesystem"]
max_turns = 15
developer_instructions = """
You are the Scout.
"""
`;

const ARCHITECT_NO_MODEL = `name = "architect"
description = "Architecture design agent."
role = "architect"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
allowed_mcp_servers = []
max_turns = 30
developer_instructions = """
You are the Architect.
"""
`;

const DEV_TEMPLATE = `name = "dev"
description = "Implementation agent."
role = "dev"
model = "gpt-5.3-codex"
model_reasoning_effort = "medium"
sandbox_mode = "workspace-write"
allowed_mcp_servers = ["filesystem", "shell"]
max_turns = 75
developer_instructions = """
You are the Dev.
"""
`;

const MISMATCHED_ROLE = `name = "qa"
description = "Mismatched role for negative test."
role = "qa"
model = "gpt-5.3-codex"
model_reasoning_effort = "medium"
allowed_mcp_servers = []
developer_instructions = "stub"
`;

const SWT_EFFORT_LEAK = `name = "qa"
description = "Uses SWT Effort tier value as Codex reasoning_effort — invalid."
role = "qa"
model = "gpt-5.3-codex"
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
    expect(spec.model).toBe('gpt-5.5');
    expect(spec.reasoning_effort).toBe('low');
    expect(spec.allowed_mcp_servers).toEqual(['filesystem']);
    expect(spec.sandbox_mode).toBe('read-only');
    expect(spec.max_turns).toBe(15);
  });

  it('resolves model from config.model_overrides[role] when set', async () => {
    const config = parseConfig({
      model_overrides: { scout: 'gpt-5.4-mini' },
    });
    const spec = await resolveAgentSpec({
      role: 'scout',
      config,
      templates_dir: templatesDir,
    });
    expect(spec.model).toBe('gpt-5.4-mini');
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
    // Bundled agents-templates declare Codex-specific models. For non-Codex
    // backends, model_overrides[role] is the documented escape hatch.
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

  it('rejects SWT Effort tier value (e.g. "balanced") used as Codex model_reasoning_effort', async () => {
    await writeFile(join(templatesDir, 'qa.toml'), SWT_EFFORT_LEAK);
    await expect(
      resolveAgentSpec({
        role: 'qa',
        config: DEFAULT_CONFIG,
        templates_dir: templatesDir,
      }),
    ).rejects.toThrow(/invalid model_reasoning_effort.*minimal.*low.*medium.*high.*xhigh/);
  });
});

describe('bundled agent templates Codex schema conformance', () => {
  const ROLES: readonly AgentRole[] = ['scout', 'architect', 'lead', 'dev', 'qa', 'debugger'];
  const CODEX_MODELS: readonly string[] = [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2',
  ];

  for (const role of ROLES) {
    it(`${role}.toml parses with Codex-conformant model + reasoning_effort + name + description`, async () => {
      const spec = await resolveAgentSpec({
        role,
        config: DEFAULT_CONFIG,
        templates_dir: getBundledAgentTemplatesDir(),
      });
      // F-01 — model is in the documented Codex catalog
      expect(CODEX_MODELS).toContain(spec.model);
      // F-02 — reasoning_effort is in the documented Codex enum
      expect(CODEX_REASONING_EFFORTS).toContain(spec.reasoning_effort);
      // F-04 — developer_instructions present (the resolver doesn't surface name/description, but the resolver tolerates them per RawTemplate)
      expect(spec.developer_instructions.length).toBeGreaterThan(0);
    });
  }
});
