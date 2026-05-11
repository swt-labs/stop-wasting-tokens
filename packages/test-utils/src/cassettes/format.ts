import { z } from 'zod';

/**
 * Cassette file format — JSONL, one object per line.
 *
 * Line 1 (HEADER) — exactly one `CassetteHeaderSchema` record.
 * Lines 2+ (INTERACTIONS) — `CassetteInteractionSchema` records, one per
 * recorded HTTP request/response pair.
 *
 * Per TDD2 §14.7.1. The format is provider-portable: the same shape works
 * for Anthropic `/v1/messages`, OpenAI `/v1/chat/completions`,
 * Google Generative AI `/v1beta/models/*:generateContent`, OpenRouter,
 * etc. Per-provider differences live in normalized body / extracted
 * usage fields, not in the cassette schema itself.
 */

export const CassetteHeaderSchema = z.object({
  schema_version: z.literal(1),
  type: z.literal('header'),
  name: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  recorded_at: z.string().datetime(),
  /**
   * Asserts the recorder stripped absolute cwd paths from the request body.
   * Every recorder MUST set this true; the replayer / replay test refuses
   * to load cassettes with `cwd_redacted: false`.
   */
  cwd_redacted: z.literal(true),
  /**
   * Optional: token-usage totals at the cassette level so PR-07's
   * cassette-replay assertion can compare delta = 0 against this
   * single source-of-truth value rather than re-summing per interaction.
   * Populated by the recorder from the final `turn_end` event's usage.
   */
  usage: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
    })
    .optional(),
});

export const CassetteInteractionSchema = z.object({
  schema_version: z.literal(1),
  type: z.literal('interaction'),
  seq: z.number().int().positive(),
  request: z.object({
    method: z.string().min(1),
    url: z.string().url(),
    /**
     * Headers AFTER normalization — sorted, lowercased keys, secrets and
     * timestamps stripped, no `authorization` / `x-api-key` / `cookie`.
     * The unredacted headers never enter the cassette.
     */
    headers_normalized: z.record(z.string(), z.string()),
    /**
     * Body hash AFTER normalization (sorted JSON keys, cwd absolute paths
     * stripped, `cache_control: {type: 'ephemeral'}` markers canonicalised).
     * SHA-256 in hex, prefixed `sha256:` for forward compatibility.
     */
    body_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
  response: z.object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
    /**
     * Response body as an array of stream chunks. For SSE / chunked
     * streaming providers (Anthropic streaming, OpenAI streaming) each
     * chunk is one server-sent event payload. For non-streaming
     * providers the array has length 1 containing the full body.
     */
    body_chunks: z.array(z.unknown()),
  }),
});

export type CassetteHeader = z.infer<typeof CassetteHeaderSchema>;
export type CassetteInteraction = z.infer<typeof CassetteInteractionSchema>;
export type CassetteLine = CassetteHeader | CassetteInteraction;
