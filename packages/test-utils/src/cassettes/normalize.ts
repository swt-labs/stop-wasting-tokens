import { createHash } from 'node:crypto';

/**
 * Request normalisation + body hashing.
 *
 * Per TDD2 §14.7.1 mitigation note: `cache_control: {type: 'ephemeral'}` markers
 * in Anthropic request bodies are deterministic given the prompt structure, but
 * they would still byte-shift the recorded vs. replayed body if the recorder
 * captured them verbatim. Normalisation canonicalises them so the body hash
 * stays stable across runs.
 *
 * Stripped from the input:
 * - Absolute cwd paths (replaced with `<cwd>` placeholder)
 * - API keys / authorization headers (replayer doesn't need them anyway)
 * - Request-time timestamps (`x-request-id`, dates in headers)
 *
 * Sorted into a canonical shape:
 * - Object keys (deterministic JSON serialisation)
 * - `cache_control` markers folded into a deterministic per-block annotation
 */

export interface NormalizedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers_normalized: Record<string, string>;
  readonly body_canonical: string; // canonical JSON string
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-request-id',
  'date',
  'cf-ray',
  'cf-cache-status',
]);

export function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (SENSITIVE_HEADERS.has(key)) continue;
    out[key] = Array.isArray(v) ? v.join(', ') : v;
  }
  // Sort keys deterministically.
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(out).sort()) {
    const value = out[key];
    if (value !== undefined) sorted[key] = value;
  }
  return sorted;
}

/**
 * Canonicalise an arbitrary JSON value: sort object keys recursively,
 * leave arrays in their original order (order is semantically significant
 * for messages / tool calls). Output is a stable JSON string suitable for
 * hashing.
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(value, replacerSortedKeys);
}

function replacerSortedKeys(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Strip absolute cwd paths from request bodies. The recorder runs in
 * developer-local cwds (paths like `/Users/alice/projects/swt-v3`) that
 * vary per machine — substituting `<cwd>` keeps the body hash stable
 * across machines and over time on the same machine.
 */
export function stripCwd(value: unknown, cwd: string): unknown {
  if (typeof value === 'string') {
    return value.split(cwd).join('<cwd>');
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripCwd(v, cwd));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripCwd(v, cwd);
    }
    return out;
  }
  return value;
}

/**
 * Normalise an Anthropic request body's `cache_control: {type: 'ephemeral'}`
 * markers. The marker is semantically a hint to Anthropic; it does not
 * change the user-visible prompt. Per ADR-006 (M4 PR-32) it sits at a
 * stable position after the artefact block. For cassette purposes we
 * canonicalise it to a single annotation per block so replayer cache_control
 * hint changes (e.g., M4 PR-32 ships a different placement) don't invalidate
 * pre-recorded cassettes that fundamentally test the same conversation.
 */
export function normalizeCacheControl(body: unknown): unknown {
  // Defensive: only Anthropic-shaped bodies have `system` / `messages` with
  // `cache_control` annotations. Other providers pass through.
  if (typeof body !== 'object' || body === null) return body;
  const cloned = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  if (Array.isArray(cloned['system'])) {
    cloned['system'] = (cloned['system'] as unknown[]).map(stripCacheControlMarker);
  }
  if (Array.isArray(cloned['messages'])) {
    cloned['messages'] = (cloned['messages'] as unknown[]).map((m) => {
      if (typeof m === 'object' && m !== null && 'content' in m) {
        const msg = m as Record<string, unknown>;
        if (Array.isArray(msg['content'])) {
          msg['content'] = (msg['content'] as unknown[]).map(stripCacheControlMarker);
        }
      }
      return m;
    });
  }
  return cloned;
}

function stripCacheControlMarker(block: unknown): unknown {
  if (typeof block !== 'object' || block === null) return block;
  const b = block as Record<string, unknown>;
  if ('cache_control' in b) {
    // Replace with a canonical marker so the presence is preserved in the
    // hash but the exact ephemeral-shape (which Anthropic may iterate) is
    // canonicalised. This lets the body hash survive ADR-006 evolution.
    return { ...b, cache_control: { type: 'ephemeral' } };
  }
  return b;
}

export interface NormalizeOptions {
  readonly cwd?: string;
}

export function normalizeRequest(
  method: string,
  url: string,
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
  opts: NormalizeOptions = {},
): NormalizedRequest {
  let normalizedBody = body;
  if (opts.cwd !== undefined && opts.cwd.length > 0) {
    normalizedBody = stripCwd(normalizedBody, opts.cwd);
  }
  normalizedBody = normalizeCacheControl(normalizedBody);
  const body_canonical = canonicalizeJson(normalizedBody);
  return {
    method: method.toUpperCase(),
    url,
    headers_normalized: normalizeHeaders(headers),
    body_canonical,
  };
}

export function hashRequest(req: NormalizedRequest): string {
  const h = createHash('sha256');
  h.update(req.method);
  h.update('\n');
  h.update(req.url);
  h.update('\n');
  // Headers are intentionally NOT part of the hash — they vary per-recorder
  // (user-agent etc.) and have already been stripped of sensitive content
  // in normalizeHeaders. The body is the source of truth for "same request".
  h.update(req.body_canonical);
  return `sha256:${h.digest('hex')}`;
}
