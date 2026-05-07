import { HandoffEnvelopeSchema } from '@swt-labs/core';
import { z } from 'zod';


const UsageChunkSchema = z.object({
  type: z.literal('result'),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export type UsageChunk = z.infer<typeof UsageChunkSchema>['usage'];

const AssistantTextChunkSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({
    content: z.array(
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
    ),
  }),
});

export interface ParsedLine {
  readonly line: string;
  readonly handoff?: Readonly<Record<string, unknown>>;
  readonly text?: string;
  readonly usage?: UsageChunk;
  readonly error?: string;
}

/**
 * Parse a single line of `claude --print --output-format stream-json` output.
 *
 * Recognised shapes:
 *  - assistant text chunk: `{type: "assistant", message: {content: [{type: "text", text}]}}`
 *  - bare text chunk: `{text: "..."}` (compatibility with simpler stream variants)
 *  - structured handoff envelope (SWT shape, validated via HandoffEnvelopeSchema)
 *  - usage chunk: `{type: "result", usage: {input_tokens, output_tokens}}`
 *
 * Any other shape is preserved as the raw line; malformed JSON yields an error.
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

  const assistantAttempt = AssistantTextChunkSchema.safeParse(obj);
  if (assistantAttempt.success) {
    const text = assistantAttempt.data.message.content
      .map((c) => c.text)
      .join('');
    if (text.length > 0) return { line, text };
  }

  if (typeof obj.text === 'string') {
    return { line, text: obj.text };
  }
  return { line };
}

/**
 * Parse a buffer of stream-json output. Splits on `\n`, drops empty
 * fragments, returns one ParsedLine per non-empty line.
 */
export function parseStream(buffer: string): readonly ParsedLine[] {
  return buffer
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseLine(line));
}
