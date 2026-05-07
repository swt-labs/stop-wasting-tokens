import type { AgentSpec, SpawnRequest } from '@swt-labs/core';
import { describe, expect, it, vi } from 'vitest';

import { OllamaAgentSpawner } from '../../src/spawner/ollama-agent-spawner.js';

const installedSpec: AgentSpec = {
  role: 'scout',
  model: 'llama3.2',
  reasoning_effort: 'balanced',
  developer_instructions: 'You are the installed Scout.',
  allowed_mcp_servers: [],
  sandbox_mode: 'read-only',
};

const requestWithDifferentSpec: SpawnRequest = {
  spec: {
    role: 'scout',
    model: 'mistral',
    reasoning_effort: 'fast',
    developer_instructions: 'fallback prompt',
    allowed_mcp_servers: [],
  },
  prompt: 'Investigate.',
  cwd: '/tmp/example',
  session_id: 'sess',
};

const successBody = `${JSON.stringify({
  model: 'llama3.2',
  message: { role: 'assistant', content: 'ok' },
  done: false,
})}\n${JSON.stringify({
  model: 'llama3.2',
  message: { role: 'assistant', content: '' },
  done: true,
  prompt_eval_count: 10,
  eval_count: 5,
})}`;

function fetchReturning(body: string): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(body),
  }) as typeof globalThis.fetch;
}

describe('OllamaAgentSpawner', () => {
  it('installAgent stores the spec; subsequent spawn uses the installed spec when role matches', async () => {
    const fetchMock = fetchReturning(successBody);
    const spawner = new OllamaAgentSpawner({
      ollama_host: 'http://localhost:11434',
      fetch: fetchMock,
    });

    await spawner.installAgent(installedSpec);
    expect(spawner.installedRoles()).toEqual(['scout']);

    await spawner.spawn(requestWithDifferentSpec);

    const callArgs = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = callArgs?.[1] as { body: string };
    const body = JSON.parse(init.body);
    // Installed spec wins: model is llama3.2, system content includes the installed
    // prompt (now wrapped with a sandbox preamble — Plan 03-04 added this layer).
    expect(body.model).toBe('llama3.2');
    expect(body.messages[0].content).toContain('You are the installed Scout.');
    expect(body.messages[0].content).toContain('SANDBOX MODE: read-only');
  });

  it('installAgent overwrites an existing entry for the same role', async () => {
    const fetchMock = fetchReturning(successBody);
    const spawner = new OllamaAgentSpawner({ fetch: fetchMock });

    await spawner.installAgent(installedSpec);
    const updated: AgentSpec = { ...installedSpec, model: 'qwen2.5' };
    await spawner.installAgent(updated);

    expect(spawner.installedRoles()).toEqual(['scout']);
    await spawner.spawn(requestWithDifferentSpec);

    const callArgs = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = callArgs?.[1] as { body: string };
    expect(JSON.parse(init.body).model).toBe('qwen2.5');
  });

  it('spawn delegates to spawnOllama and returns the parsed SpawnResult', async () => {
    const fetchMock = fetchReturning(successBody);
    const spawner = new OllamaAgentSpawner({ fetch: fetchMock });
    await spawner.installAgent(installedSpec);

    const result = await spawner.spawn(requestWithDifferentSpec);

    expect(result.role).toBe('scout');
    expect(result.success).toBe(true);
    expect(result.text).toBe('ok');
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('removeAgent deletes the entry; subsequent spawn falls back to the request spec', async () => {
    const fetchMock = fetchReturning(successBody);
    const spawner = new OllamaAgentSpawner({ fetch: fetchMock });

    await spawner.installAgent(installedSpec);
    await spawner.removeAgent('scout');
    expect(spawner.installedRoles()).toEqual([]);

    await spawner.spawn(requestWithDifferentSpec);
    const callArgs = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = callArgs?.[1] as { body: string };
    // Falls back to request.spec since no role is installed.
    expect(JSON.parse(init.body).model).toBe('mistral');
  });

  it('removeAgent on an absent role is a no-op (does not throw)', async () => {
    const spawner = new OllamaAgentSpawner();
    await expect(spawner.removeAgent('debugger')).resolves.toBeUndefined();
  });
});
