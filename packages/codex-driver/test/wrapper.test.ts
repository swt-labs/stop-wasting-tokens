import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SpawnRequest } from '@swt-labs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sampleRequest: SpawnRequest = {
  spec: {
    role: 'scout',
    model: 'gpt-5-codex',
    reasoning_effort: 'balanced',
    developer_instructions: 'You are the Scout.',
    allowed_mcp_servers: [],
    sandbox_mode: 'read-only',
  },
  prompt: 'Investigate.',
  cwd: '/tmp/example',
  session_id: 'test-session',
};

afterEach(() => {
  vi.doUnmock('execa');
  vi.resetModules();
});

describe('spawnCodex usage round-trip', () => {
  it('populates SpawnResult.usage when the stream contains a usage chunk', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'codex-stream-with-usage.ndjson');
    const stdout = await readFile(fixturePath, 'utf8');
    const execaMock = vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    vi.doMock('execa', () => ({ execa: execaMock }));
    vi.resetModules();
    const { spawnCodex: spawnCodexFresh } = await import('../src/spawn/wrapper.js');

    const result = await spawnCodexFresh(sampleRequest);

    expect(result.success).toBe(true);
    expect(result.usage).toEqual({ input_tokens: 4218, output_tokens: 312 });
    expect(result.text).toBe('Investigating the auth module.\nDone.');
  });

  it('omits SpawnResult.usage when no usage chunk is emitted', async () => {
    const stdout = `${JSON.stringify({ text: 'hello' })}\n`;
    const execaMock = vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    vi.doMock('execa', () => ({ execa: execaMock }));
    vi.resetModules();
    const { spawnCodex: spawnCodexFresh } = await import('../src/spawn/wrapper.js');

    const result = await spawnCodexFresh(sampleRequest);

    expect(result.success).toBe(true);
    expect(result.usage).toBeUndefined();
    expect(result.text).toBe('hello');
  });

  it('aggregates usage last-write-wins when multiple chunks appear', async () => {
    const stdout = [
      JSON.stringify({ type: 'usage', usage: { input_tokens: 100, output_tokens: 10 } }),
      JSON.stringify({ text: 'progress' }),
      JSON.stringify({ type: 'usage', usage: { input_tokens: 250, output_tokens: 42 } }),
    ].join('\n');
    const execaMock = vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    vi.doMock('execa', () => ({ execa: execaMock }));
    vi.resetModules();
    const { spawnCodex: spawnCodexFresh } = await import('../src/spawn/wrapper.js');

    const result = await spawnCodexFresh(sampleRequest);

    // Final chunk is canonical
    expect(result.usage).toEqual({ input_tokens: 250, output_tokens: 42 });
  });
});
