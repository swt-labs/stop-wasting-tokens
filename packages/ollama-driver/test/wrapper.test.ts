import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SpawnRequest } from '@swt-labs/core';
import { describe, expect, it, vi } from 'vitest';


import { spawnOllama } from '../src/spawn/wrapper.js';

const sampleRequest: SpawnRequest = {
  spec: {
    role: 'scout',
    model: 'llama3.2',
    reasoning_effort: 'balanced',
    developer_instructions: 'You are the Scout.',
    allowed_mcp_servers: [],
    sandbox_mode: 'read-only',
  },
  prompt: 'Investigate.',
  cwd: '/tmp/example',
  session_id: 'test-session',
};

function fetchReturning(body: string, ok = true, status = 200, statusText = 'OK'): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    text: () => Promise.resolve(body),
  }) as typeof globalThis.fetch;
}

describe('spawnOllama wrapper', () => {
  it('happy path: text fixture aggregates into SpawnResult.text + usage', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'ollama-stream-text.ndjson');
    const stdout = await readFile(fixturePath, 'utf8');
    const fetchMock = fetchReturning(stdout);

    const result = await spawnOllama(sampleRequest, { fetch: fetchMock });

    expect(result.success).toBe(true);
    expect(result.text).toBe('Investigating the auth module.');
    expect(result.handoff).toBeUndefined();
    expect(result.usage).toEqual({ input_tokens: 2104, output_tokens: 156 });
  });

  it('handoff fixture parses the structured envelope from concatenated text', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'ollama-stream-with-handoff.ndjson');
    const stdout = await readFile(fixturePath, 'utf8');
    const fetchMock = fetchReturning(stdout);

    const result = await spawnOllama(sampleRequest, { fetch: fetchMock });

    expect(result.success).toBe(true);
    expect(result.handoff).toBeDefined();
    expect(result.handoff?.kind).toBe('scout-findings');
    expect(result.usage).toEqual({ input_tokens: 3140, output_tokens: 284 });
  });

  it('non-ok response yields success=false with error from response body', async () => {
    const fetchMock = fetchReturning('model not found', false, 404, 'Not Found');

    const result = await spawnOllama(sampleRequest, { fetch: fetchMock });

    expect(result.success).toBe(false);
    expect(result.error).toContain('model not found');
  });
});
