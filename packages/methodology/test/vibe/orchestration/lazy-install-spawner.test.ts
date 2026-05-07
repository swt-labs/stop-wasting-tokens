import type { AgentRole, AgentSpec, AgentSpawner, SpawnRequest, SpawnResult } from '@swt-labs/core';
import { describe, expect, it, vi } from 'vitest';

import { LazyInstallSpawner } from '../../../src/vibe/orchestration/lazy-install-spawner.js';

function makeSpec(role: AgentRole): AgentSpec {
  return {
    role,
    model: 'gpt-5-codex',
    reasoning_effort: 'balanced',
    developer_instructions: '',
    allowed_mcp_servers: [],
  };
}

function makeRequest(role: AgentRole): SpawnRequest {
  return {
    spec: makeSpec(role),
    prompt: 'test',
    cwd: '/tmp',
    session_id: 'sess',
  };
}

function makeBase(): AgentSpawner & {
  installAgent: ReturnType<typeof vi.fn>;
  spawn: ReturnType<typeof vi.fn>;
  removeAgent: ReturnType<typeof vi.fn>;
} {
  return {
    installAgent: vi.fn(async () => undefined),
    spawn: vi.fn(
      async (req: SpawnRequest): Promise<SpawnResult> => ({
        role: req.spec.role,
        success: true,
        text: 'ok',
      }),
    ),
    removeAgent: vi.fn(async () => undefined),
  };
}

describe('LazyInstallSpawner', () => {
  it('installs the role on first spawn and reuses the install on subsequent spawns', async () => {
    const base = makeBase();
    const resolveSpec = vi.fn(async (role: AgentRole) => makeSpec(role));
    const spawner = new LazyInstallSpawner(base, resolveSpec);

    await spawner.spawn(makeRequest('dev'));
    await spawner.spawn(makeRequest('dev'));

    expect(resolveSpec).toHaveBeenCalledTimes(1);
    expect(base.installAgent).toHaveBeenCalledTimes(1);
    expect(base.spawn).toHaveBeenCalledTimes(2);
    expect(spawner.installedRoles()).toEqual(['dev']);
  });

  it('installs each role independently when multiple spawns are issued', async () => {
    const base = makeBase();
    const resolveSpec = vi.fn(async (role: AgentRole) => makeSpec(role));
    const spawner = new LazyInstallSpawner(base, resolveSpec);

    await spawner.spawn(makeRequest('dev'));
    await spawner.spawn(makeRequest('scout'));
    await spawner.spawn(makeRequest('dev'));

    expect(resolveSpec).toHaveBeenCalledTimes(2);
    expect(base.installAgent).toHaveBeenCalledTimes(2);
    const installed = spawner.installedRoles().slice().sort();
    expect(installed).toEqual(['dev', 'scout']);
  });

  it('deduplicates concurrent first spawns for the same role to a single install', async () => {
    const base = makeBase();
    const resolveSpec = vi.fn(async (role: AgentRole) => makeSpec(role));
    const spawner = new LazyInstallSpawner(base, resolveSpec);

    await Promise.all([
      spawner.spawn(makeRequest('dev')),
      spawner.spawn(makeRequest('dev')),
      spawner.spawn(makeRequest('dev')),
    ]);

    expect(resolveSpec).toHaveBeenCalledTimes(1);
    expect(base.installAgent).toHaveBeenCalledTimes(1);
    expect(base.spawn).toHaveBeenCalledTimes(3);
  });

  it('cleanup removes every installed role and never throws even when removeAgent rejects', async () => {
    const base = makeBase();
    base.removeAgent.mockImplementation(async (role: AgentRole) => {
      if (role === 'scout') throw new Error('boom');
    });
    const resolveSpec = vi.fn(async (role: AgentRole) => makeSpec(role));
    const spawner = new LazyInstallSpawner(base, resolveSpec);

    await spawner.spawn(makeRequest('dev'));
    await spawner.spawn(makeRequest('scout'));

    await expect(spawner.cleanup()).resolves.toBeUndefined();
    expect(base.removeAgent).toHaveBeenCalledTimes(2);
    expect(spawner.installedRoles()).toEqual([]);
  });

  it('explicit installAgent registers the role so spawn does not double-install', async () => {
    const base = makeBase();
    const resolveSpec = vi.fn(async (role: AgentRole) => makeSpec(role));
    const spawner = new LazyInstallSpawner(base, resolveSpec);

    await spawner.installAgent(makeSpec('qa'));
    await spawner.spawn(makeRequest('qa'));

    expect(resolveSpec).not.toHaveBeenCalled();
    expect(base.installAgent).toHaveBeenCalledTimes(1);
    expect(base.spawn).toHaveBeenCalledTimes(1);
  });
});
