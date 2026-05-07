import { HandoffEnvelopeSchema } from '@swt-labs/core';
import { z } from 'zod';


const OllamaChunkSchema = z.object({
  model: z.string(),
  message: z
    .object({
      role: z.string(),
      content: z.string(),
    })
    .optional(),
  done: z.boolean(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

export interface UsageChunk {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface ParsedLine {
  readonly line: string;
  readonly text?: string;
  readonly done?: boolean;
  readonly usage?: UsageChunk;
  readonly error?: string;
}

/**
 * Parse a single line of Ollama `/api/chat` NDJSON streaming response.
 *
 * Per-line shape (per Ollama's documented schema):
 * - intermediate: `{model, message: {role, content}, done: false}` — text chunk
 * - final: `{model, message: {role, content: ""}, done: true, prompt_eval_count, eval_count}` — usage
 *
 * Malformed JSON yields an error field.
 */
export function parseLine(line: string): ParsedLine {
  if (line.length === 0) return { line };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    return { line, error: cause instanceof Error ? cause.message : String(cause) };
  }

  const attempt = OllamaChunkSchema.safeParse(parsed);
  if (!attempt.success) return { line };
  const data = attempt.data;

  const text = data.message?.content;
  if (data.done === true) {
    const usage: UsageChunk | undefined =
      typeof data.prompt_eval_count === 'number' && typeof data.eval_count === 'number'
        ? { input_tokens: data.prompt_eval_count, output_tokens: data.eval_count }
        : undefined;
    return {
      line,
      done: true,
      ...(text !== undefined && text.length > 0 ? { text } : {}),
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  return {
    line,
    done: false,
    ...(text !== undefined && text.length > 0 ? { text } : {}),
  };
}

export interface StreamResult {
  readonly text: string;
  readonly usage?: UsageChunk;
  readonly handoff?: Readonly<Record<string, unknown>>;
  readonly errors: readonly string[];
}

/**
 * Parse a buffer of NDJSON output. Returns aggregated text + final usage.
 * Ollama doesn't have a structured handoff envelope field — agents that
 * emit a SWT handoff bake it into the response text. parseStream attempts
 * to extract a handoff envelope from the concatenated text via the same
 * HandoffEnvelopeSchema Phase 02's parser uses.
 */
export function parseStream(buffer: string): StreamResult {
  const errors: string[] = [];
  let text = '';
  let usage: UsageChunk | undefined;
  for (const raw of buffer.split('\n')) {
    if (raw.length === 0) continue;
    const parsed = parseLine(raw);
    if (parsed.error !== undefined) {
      errors.push(parsed.error);
      continue;
    }
    if (parsed.text !== undefined) text = `${text}${parsed.text}`;
    if (parsed.usage !== undefined) usage = parsed.usage;
  }

  let handoff: Readonly<Record<string, unknown>> | undefined;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const candidate = JSON.parse(trimmed) as unknown;
      const envelopeAttempt = HandoffEnvelopeSchema.safeParse(candidate);
      if (envelopeAttempt.success) handoff = envelopeAttempt.data;
    } catch {
      // Not a handoff envelope; leave undefined.
    }
  }

  return {
    text,
    ...(usage !== undefined ? { usage } : {}),
    ...(handoff !== undefined ? { handoff } : {}),
    errors,
  };
}
