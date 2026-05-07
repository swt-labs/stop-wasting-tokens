import { HandoffEnvelopeSchema } from '@swt-labs/core';
import { z } from 'zod';


const UsageChunkSchema = z.object({
  type: z.literal('usage'),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export type UsageChunk = z.infer<typeof UsageChunkSchema>['usage'];

export interface ParsedLine {
  readonly line: string;
  readonly handoff?: Readonly<Record<string, unknown>>;
  readonly text?: string;
  readonly usage?: UsageChunk;
  readonly error?: string;
}

/**
 * Parse a single Codex `--json` NDJSON line.
 *
 * Codex emits one JSON object per line. SWT recognises two shapes:
 *  - a generic `{ "text": "…" }` chunk — surfaced as `text`
 *  - a structured handoff envelope (validated against HandoffEnvelopeSchema)
 *
 * Any other shape is preserved as the raw line so callers can decide how to
 * handle it. Malformed JSON yields an `error` field.
 */
export function parseLine(line: string): ParsedLine {
  if (line.length === 0) return { line };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    return { line, error: cause instanceof Error ? cause.message : String(cause) };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { line };
  }
  const obj = parsed as Record<string, unknown>;

  const envelopeAttempt = HandoffEnvelopeSchema.safeParse(obj);
  if (envelopeAttempt.success) {
    return { line, handoff: envelopeAttempt.data };
  }

  const usageAttempt = UsageChunkSchema.safeParse(obj);
  if (usageAttempt.success) {
    return { line, usage: usageAttempt.data.usage };
  }

  if (typeof obj.text === 'string') {
    return { line, text: obj.text };
  }
  return { line };
}

/**
 * Parse a buffer of NDJSON output (e.g. accumulated stdout from `codex exec`).
 * Splits on `\n`, drops trailing empty fragments, and returns one ParsedLine
 * per non-empty line.
 */
export function parseStream(buffer: string): readonly ParsedLine[] {
  return buffer
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseLine(line));
}
