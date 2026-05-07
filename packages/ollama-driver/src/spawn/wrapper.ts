import { BackendError, type SpawnRequest, type SpawnResult } from '@swt-labs/core';

import { parseStream } from './parser.js';

export const OLLAMA_HOST_DEFAULT = 'http://localhost:11434';

export interface SpawnFlags {
  /** Override the Ollama host base URL (default $OLLAMA_HOST or http://localhost:11434). */
  readonly ollama_host?: string;
  /** Override the fetch implementation (default globalThis.fetch). */
  readonly fetch?: typeof globalThis.fetch;
  /** Override the system prompt sent to Ollama (default: spec.developer_instructions). */
  readonly system_prompt_override?: string;
  /** Override the keep_alive duration (default '5m'). */
  readonly keep_alive?: string;
}

interface ChatRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  keep_alive: string;
}

function composeBody(request: SpawnRequest, flags: SpawnFlags): ChatRequestBody {
  const systemPrompt = flags.system_prompt_override ?? request.spec.developer_instructions;
  return {
    model: request.spec.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request.prompt },
    ],
    stream: true,
    keep_alive: flags.keep_alive ?? '5m',
  };
}

export async function spawnOllama(
  request: SpawnRequest,
  flags: SpawnFlags = {},
): Promise<SpawnResult> {
  const host = flags.ollama_host ?? process.env['OLLAMA_HOST'] ?? OLLAMA_HOST_DEFAULT;
  const fetchImpl = flags.fetch ?? globalThis.fetch;
  const url = `${host.replace(/\/$/, '')}/api/chat`;
  const body = composeBody(request, flags);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new BackendError(
      `ollama fetch failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause, context: { url, model: body.model } },
    );
  }

  const buffer = await response.text();
  const stream = parseStream(buffer);

  if (!response.ok) {
    return {
      role: request.spec.role,
      success: false,
      ...(stream.text.length > 0 ? { text: stream.text } : {}),
      ...(stream.handoff !== undefined ? { handoff: stream.handoff } : {}),
      ...(stream.usage !== undefined ? { usage: stream.usage } : {}),
      error:
        buffer.length > 0
          ? buffer.slice(0, 200)
          : `ollama responded ${response.status} ${response.statusText}`,
    };
  }

  return {
    role: request.spec.role,
    success: true,
    ...(stream.text.length > 0 ? { text: stream.text } : {}),
    ...(stream.handoff !== undefined ? { handoff: stream.handoff } : {}),
    ...(stream.usage !== undefined ? { usage: stream.usage } : {}),
  };
}
