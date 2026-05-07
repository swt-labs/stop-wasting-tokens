import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSpec, SpawnRequest } from '@swt-labs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { CodexAgentSpawner } from '../../src/spawner/codex-agent-spawner.js';

const sampleSpec: AgentSpec = {
  role: 'scout',
  model: 'gpt-5-codex',
  reasoning_effort: 'balanced',
  developer_instructions: 'You are the Scout. Investigate.',
  allowed_mcp_servers: ['filesystem'],
  sandbox_mode: 'read-only',
  max_turns: 15,
};

const sampleRequest: SpawnRequest = {
  spec: sampleSpec,
  prompt: 'Investigate the auth module.',
  cwd: '/tmp/example',
  session_id: 'test-session-123',
};

let codexHome: string;

beforeEach(async () => {
  codexHome = await mkdtemp(join(tmpdir(), 'swt-codex-spawner-'));
});

afterEach(async () => {
  await rm(codexHome, { recursive: true, force: true });
});

describe('CodexAgentSpawner', () => {
  describe('installAgent', () => {
    it('writes the TOML profile to {codex_home}/agents/{role}.toml', async () => {
      const spawner = new CodexAgentSpawner({ codex_home: codexHome });
      await spawner.installAgent(sampleSpec);
      const target = join(codexHome, 'agents', 'scout.toml');
      const stats = await stat(target);
      expect(stats.isFile()).toBe(true);
      const content = await readFile(target, 'utf8');
      expect(content).toContain('role = "scout"');
      expect(content).toContain('model = "gpt-5-codex"');
      expect(content).toContain('sandbox_mode = "read-only"');
    });

    it('is idempotent on re-install (final TOML reflects the latest spec)', async () => {
      const spawner = new CodexAgentSpawner({ codex_home: codexHome });
      await spawner.installAgent(sampleSpec);
      const updated: AgentSpec = { ...sampleSpec, model: 'gpt-5-codex-mini' };
      await spawner.installAgent(updated);
      const content = await readFile(join(codexHome, 'agents', 'scout.toml'), 'utf8');
      expect(content).toContain('model = "gpt-5-codex-mini"');
      expect(content).not.toContain('model = "gpt-5-codex"\n');
    });
  });

  describe('spawn', () => {
    it('delegates to spawnCodex via the configured bin', async () => {
      const execaMock = vi.fn().mockResolvedValue({
        stdout: '{"text":"ok"}',
        stderr: '',
        exitCode: 0,
      });
      vi.doMock('execa', () => ({ execa: execaMock }));
      // Re-import after mock so spawnCodex picks up the stub.
      vi.resetModules();
      const { CodexAgentSpawner: SpawnerWithMock } = await import(
        '../../src/spawner/codex-agent-spawner.js'
      );
      const spawner = new SpawnerWithMock({
        codex_home: codexHome,
        bin: '/opt/codex/bin/codex',
      });
      const result = await spawner.spawn(sampleRequest);
      expect(result.role).toBe('scout');
      expect(result.success).toBe(true);
      expect(execaMock).toHaveBeenCalledWith(
        '/opt/codex/bin/codex',
        expect.arrayContaining(['exec', '--json', '--cd', '/tmp/example']),
        expect.objectContaining({ cwd: '/tmp/example' }),
      );
      vi.doUnmock('execa');
      vi.resetModules();
    });
  });

  describe('removeAgent', () => {
    it('unlinks the TOML profile', async () => {
      const spawner = new CodexAgentSpawner({ codex_home: codexHome });
      await spawner.installAgent(sampleSpec);
      await spawner.removeAgent('scout');
      await expect(stat(join(codexHome, 'agents', 'scout.toml'))).rejects.toThrow();
    });

    it('is a no-op when the profile is missing', async () => {
      const spawner = new CodexAgentSpawner({ codex_home: codexHome });
      await expect(spawner.removeAgent('debugger')).resolves.toBeUndefined();
    });
  });
});
