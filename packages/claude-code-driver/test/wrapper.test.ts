import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SpawnRequest } from '@swt-labs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sampleRequest: SpawnRequest = {
  spec: {
    role: 'scout',
    model: 'sonnet',
    reasoning_effort: 'balanced',
    developer_instructions: 'You are the Scout.',
    allowed_mcp_servers: [],
    sandbox_mode: 'read-only',
  },
  prompt: 'Investigate the auth module.',
  cwd: '/tmp/example',
  session_id: '00000000-0000-0000-0000-000000000001',
};

afterEach(() => {
  vi.doUnmock('execa');
  vi.resetModules();
});

describe('spawnClaude wrapper', () => {
  it('happy path: text fixture aggregates into SpawnResult.text + usage', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'claude-stream-text.ndjson');
    const stdout = await readFile(fixturePath, 'utf8');
    const execaMock = vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    vi.doMock('execa', () => ({ execa: execaMock }));
    vi.resetModules();
    const { spawnClaude } = await import('../src/spawn/wrapper.js');

    const result = await spawnClaude(sampleRequest);

    expect(result.success).toBe(true);
    expect(result.text).toBe('Investigating the auth module.\nFound the issue.\nDone.');
    expect(result.handoff).toBeUndefined();
    expect(result.usage).toEqual({ input_tokens: 2104, output_tokens: 156 });
  });

  it('handoff fixture surfaces the structured envelope', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'claude-stream-with-handoff.ndjson');
    const stdout = await readFile(fixturePath, 'utf8');
    const execaMock = vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    vi.doMock('execa', () => ({ execa: execaMock }));
    vi.resetModules();
    const { spawnClaude } = await import('../src/spawn/wrapper.js');

    const result = await spawnClaude(sampleRequest);

    expect(result.success).toBe(true);
    expect(result.handoff).toBeDefined();
    expect(result.handoff?.kind).toBe('scout-findings');
    expect(result.usage).toEqual({ input_tokens: 3140, output_tokens: 284 });
  });

  it('non-zero exit code yields success=false with error text', async () => {
    const execaMock = vi
      .fn()
      .mockResolvedValue({ stdout: '', stderr: 'auth required', exitCode: 1 });
    vi.doMock('execa', () => ({ execa: execaMock }));
    vi.resetModules();
    const { spawnClaude } = await import('../src/spawn/wrapper.js');

    const result = await spawnClaude(sampleRequest);

    expect(result.success).toBe(false);
    expect(result.error).toBe('auth required');
  });
});
