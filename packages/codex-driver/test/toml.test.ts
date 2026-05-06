import { describe, expect, it } from 'vitest';

import { emitAgentToml, emitAgentsGlobalToml } from '../src/toml/agents.js';
import { emitToml } from '../src/toml/emit.js';
import { emitFeaturesToml } from '../src/toml/features.js';
import { emitPermissionToml } from '../src/toml/permissions.js';

describe('TOML emitter', () => {
  it('emits scalars and arrays', () => {
    const out = emitToml({ name: 'swt', version: 1, enabled: true, tags: ['a', 'b'] });
    expect(out).toContain('name = "swt"');
    expect(out).toContain('version = 1');
    expect(out).toContain('enabled = true');
    expect(out).toContain('tags = ["a", "b"]');
  });

  it('escapes special characters in strings', () => {
    const out = emitToml({ note: 'has "quotes" and a \\ backslash' });
    expect(out).toContain('note = "has \\"quotes\\" and a \\\\ backslash"');
  });

  it('promotes complex sub-objects to table headers', () => {
    const out = emitToml({
      agents: { max_threads: 6, max_depth: 1, roles: ['scout', 'lead'] },
    });
    expect(out).toContain('[agents]');
    expect(out).toContain('max_threads = 6');
    expect(out).toContain('roles = ["scout", "lead"]');
  });
});

describe('agent TOML', () => {
  it('serialises an AgentSpec', () => {
    const out = emitAgentToml({
      role: 'lead',
      model: 'gpt-x',
      reasoning_effort: 'thorough',
      developer_instructions: 'Plan thoroughly. Use must_haves.',
      allowed_mcp_servers: ['filesystem'],
      sandbox_mode: 'workspace-write',
      max_turns: 50,
    });
    expect(out).toContain('role = "lead"');
    expect(out).toContain('model = "gpt-x"');
    expect(out).toContain('model_reasoning_effort = "thorough"');
    expect(out).toContain('sandbox_mode = "workspace-write"');
    expect(out).toContain('max_turns = 50');
  });

  it('emits the global [agents] block with defaults', () => {
    const out = emitAgentsGlobalToml();
    expect(out).toContain('[agents]');
    expect(out).toContain('max_threads = 6');
    expect(out).toContain('max_depth = 1');
  });
});

describe('permission TOML', () => {
  it('emits a [permissions.<name>] block', () => {
    const out = emitPermissionToml({
      name: 'lead',
      sandbox_mode: 'workspace-write',
      approval_policy: 'on-request',
      writable_roots: ['./src', './packages'],
    });
    expect(out).toContain('[permissions.lead]');
    expect(out).toContain('sandbox_mode = "workspace-write"');
    expect(out).toContain('approval_policy = "on-request"');
    expect(out).toContain('writable_roots = ["./src", "./packages"]');
  });
});

describe('features TOML', () => {
  it('emits an empty string when no flags are set', () => {
    expect(emitFeaturesToml({})).toBe('');
  });

  it('emits a [features] table when flags are present', () => {
    const out = emitFeaturesToml({ experimental_streaming: true, legacy_resume: false });
    expect(out).toContain('[features]');
    expect(out).toContain('experimental_streaming = true');
    expect(out).toContain('legacy_resume = false');
  });
});
