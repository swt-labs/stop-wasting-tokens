import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSpec, SpawnRequest } from '@swt-labs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { ClaudeCodeAgentSpawner } from '../../src/spawner/claude-code-agent-spawner.js';

const sampleSpec: AgentSpec = {
  role: 'scout',
  model: 'sonnet',
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
  session_id: '00000000-0000-0000-0000-000000000001',
};

let claudeConfigDir: string;

beforeEach(async () => {
  claudeConfigDir = await mkdtemp(join(tmpdir(), 'swt-claude-spawner-'));
});

afterEach(async () => {
  await rm(claudeConfigDir, { recursive: true, force: true });
});

describe('ClaudeCodeAgentSpawner', () => {
  describe('installAgent', () => {
    it('writes the JSON profile to {claude_config_dir}/agents/{role}.json', async () => {
      const spawner = new ClaudeCodeAgentSpawner({ claude_config_dir: claudeConfigDir });
      await spawner.installAgent(sampleSpec);
      const target = join(claudeConfigDir, 'agents', 'scout.json');
      const stats = await stat(target);
      expect(stats.isFile()).toBe(true);
      const profile = JSON.parse(await readFile(target, 'utf8'));
      expect(profile.prompt).toBe('You are the Scout. Investigate.');
      expect(profile.model).toBe('sonnet');
      expect(profile.tools).toEqual(['filesystem']);
      expect(profile.sandbox_mode).toBe('read-only');
      expect(profile.max_turns).toBe(15);
    });

    it('is idempotent on re-install (final JSON reflects the latest spec)', async () => {
      const spawner = new ClaudeCodeAgentSpawner({ claude_config_dir: claudeConfigDir });
      await spawner.installAgent(sampleSpec);
      const updated: AgentSpec = { ...sampleSpec, model: 'opus' };
      await spawner.installAgent(updated);
      const profile = JSON.parse(
        await readFile(join(claudeConfigDir, 'agents', 'scout.json'), 'utf8'),
      );
      expect(profile.model).toBe('opus');
    });
  });

  describe('spawn', () => {
    it('delegates to spawnClaude via the configured bin', async () => {
      const execaMock = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'ok' }] },
        }),
        stderr: '',
        exitCode: 0,
      });
      vi.doMock('execa', () => ({ execa: execaMock }));
      vi.resetModules();
      const { ClaudeCodeAgentSpawner: SpawnerWithMock } = await import(
        '../../src/spawner/claude-code-agent-spawner.js'
      );
      const spawner = new SpawnerWithMock({
        claude_config_dir: claudeConfigDir,
        bin: '/opt/claude/bin/claude',
      });
      const result = await spawner.spawn(sampleRequest);
      expect(result.role).toBe('scout');
      expect(result.success).toBe(true);
      expect(execaMock).toHaveBeenCalledWith(
        '/opt/claude/bin/claude',
        expect.arrayContaining(['--print', '--output-format', 'stream-json']),
        expect.objectContaining({ cwd: '/tmp/example' }),
      );
      vi.doUnmock('execa');
      vi.resetModules();
    });
  });

  describe('removeAgent', () => {
    it('unlinks the JSON profile', async () => {
      const spawner = new ClaudeCodeAgentSpawner({ claude_config_dir: claudeConfigDir });
      await spawner.installAgent(sampleSpec);
      await spawner.removeAgent('scout');
      await expect(stat(join(claudeConfigDir, 'agents', 'scout.json'))).rejects.toThrow();
    });

    it('is a no-op when the profile is missing', async () => {
      const spawner = new ClaudeCodeAgentSpawner({ claude_config_dir: claudeConfigDir });
      await expect(spawner.removeAgent('debugger')).resolves.toBeUndefined();
    });
  });
});
