/**
 * Cassette recorder (developer-local only).
 *
 * Installs an undici dispatcher interceptor (via `Agent#compose`) that
 * captures every outbound HTTP request, normalises the body, hashes it,
 * and appends a `CassetteInteractionSchema`-shaped JSON line to the
 * cassette JSONL. The interceptor delegates to the real network so the
 * recorder is observe-only on the wire.
 *
 * Usage from a test or one-shot script:
 *   await record({
 *     scenario: 'scout-read-readme',
 *     provider: 'anthropic',
 *     model: 'claude-sonnet-4-5',
 *     outputPath: 'packages/test-utils/cassettes/scout-read-readme.jsonl',
 *     run: async () => {
 *       // arbitrary code that hits the provider via fetch
 *       await piSession.prompt('...');
 *     },
 *   });
 *
 * Per TDD2 §14.7.2 + Phase 5 plan 05-01 task T1. The recorder is NEVER
 * invoked from CI; recordings happen on a developer machine with real
 * API credentials.
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';

import type { Dispatcher } from 'undici';
import { Agent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

import {
  CassetteHeaderSchema,
  CassetteInteractionSchema,
  type CassetteHeader,
  type CassetteInteraction,
} from './format.js';
import { hashRequest, normalizeRequest } from './normalize.js';

export interface RecordOptions {
  readonly scenario: string;
  readonly provider: string;
  readonly model: string;
  readonly outputPath: string;
  /**
   * Function that runs the real interaction. Called AFTER the recorder
   * is installed; any fetch() calls inside are intercepted, the real
   * request goes through to the network, the response is captured and
   * written to the cassette.
   */
  readonly run: () => Promise<void>;
  /**
   * Optional cwd to strip from request bodies. Defaults to `process.cwd()`.
   * Pass an explicit cwd for tests that simulate a different working dir.
   */
  readonly cwd?: string;
  /**
   * Optional override for the underlying dispatcher the recorder
   * delegates intercepted requests through. Defaults to the currently
   * installed global dispatcher. Tests can pass a custom Agent (for
   * example one preconfigured for a local fixture server) here.
   */
  readonly innerDispatcher?: Dispatcher;
  /**
   * If true, every outbound request is recorded regardless of host. If
   * false (default) only requests whose URL matches `PROVIDER_HOSTS` are
   * captured — out-of-scope traffic (npm registry, github.com, etc.)
   * passes straight through without producing JSONL lines.
   */
  readonly captureAllHosts?: boolean;
}

/**
 * Provider URL prefixes the recorder considers in-scope. Out-of-scope
 * URLs (e.g., npm registry, github.com) pass through without capture.
 */
const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.bedrock.amazonaws.com',
];

function isProviderUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return PROVIDER_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

function originFromOpts(opts: Dispatcher.DispatchOptions): string {
  const o = opts.origin;
  if (o === undefined || o === null) return '';
  return typeof o === 'string' ? o : o.toString();
}

function fullUrl(opts: Dispatcher.DispatchOptions): string {
  const origin = originFromOpts(opts);
  if (!origin) return opts.path;
  return origin.replace(/\/$/, '') + opts.path;
}

function headersToRecord(
  headers: Dispatcher.DispatchOptions['headers'],
): Record<string, string | string[] | undefined> {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    const out: Record<string, string | string[] | undefined> = {};
    for (let i = 0; i < headers.length; i += 2) {
      const k = headers[i];
      const v = headers[i + 1];
      if (typeof k === 'string' && typeof v === 'string') out[k] = v;
    }
    return out;
  }
  if (typeof (headers as Iterable<[string, unknown]>)[Symbol.iterator] === 'function') {
    const out: Record<string, string | string[] | undefined> = {};
    for (const entry of headers as Iterable<[string, string | string[] | undefined]>) {
      out[entry[0]] = entry[1];
    }
    return out;
  }
  return headers as Record<string, string | string[] | undefined>;
}

/**
 * Read an undici dispatch body into a Buffer (or empty Buffer for
 * null/undefined). Streams are consumed into memory — cassette
 * recordings target relatively small Anthropic/OpenAI bodies, so this
 * is acceptable. For very large request bodies an alternative tee
 * pattern would be required, but no such case exists in the SWT
 * cassette scope today.
 */
async function readDispatchBody(body: Dispatcher.DispatchOptions['body']): Promise<Buffer> {
  if (body === null || body === undefined) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Buffer) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  // Async iterable (undici `fetch()` POST bodies arrive as bare async
  // iterables, not `Readable` instances — see undici 6.x request-body
  // normalisation). Iterate to drain.
  const asyncIter = (body as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> })[
    Symbol.asyncIterator
  ];
  if (typeof asyncIter === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      else if (typeof chunk === 'string') chunks.push(Buffer.from(chunk, 'utf8'));
    }
    return Buffer.concat(chunks);
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else if (typeof chunk === 'string') chunks.push(Buffer.from(chunk, 'utf8'));
      else chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  // FormData is not part of the cassette scope (Anthropic/OpenAI use JSON).
  return Buffer.alloc(0);
}

function decodeBodyToValue(buf: Buffer): unknown {
  if (buf.length === 0) return '';
  const text = buf.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeResponseHeaders(headers: Buffer[] | string[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (let i = 0; i < headers.length; i += 2) {
    const k = headers[i];
    const v = headers[i + 1];
    const ks = Buffer.isBuffer(k) ? k.toString('utf8') : k;
    const vs = Buffer.isBuffer(v) ? v.toString('utf8') : v;
    if (ks !== undefined && vs !== undefined) out[ks.toLowerCase()] = vs;
  }
  return out;
}

/**
 * Record one scenario into a JSONL cassette.
 *
 * The interceptor pipeline:
 *   1. Capture outbound (method, url, headers, body) for in-scope hosts.
 *   2. Compute the normalised body + `sha256:` body_hash via
 *      `normalize.ts` helpers (cwd-redacted so the hash is stable
 *      across recording hosts).
 *   3. Forward to the inner dispatcher — the live request still hits
 *      the provider during recording (this is `pnpm record`, not CI).
 *   4. Capture inbound (status, headers, body chunks). Chunks are kept
 *      separate so SSE event framing survives the round-trip.
 *   5. Synchronously append a `CassetteInteractionSchema`-valid JSON
 *      line with monotonic `seq` (1..N).
 *
 * On `handle.uninstall()` (or end of `run()`), the global dispatcher
 * is restored to its pre-record state.
 */
export async function record(opts: RecordOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();

  mkdirSync(dirname(opts.outputPath), { recursive: true });

  const header: CassetteHeader = {
    schema_version: 1,
    type: 'header',
    name: opts.scenario,
    provider: opts.provider,
    model: opts.model,
    recorded_at: new Date().toISOString(),
    cwd_redacted: true,
  };
  CassetteHeaderSchema.parse(header);
  writeFileSync(opts.outputPath, JSON.stringify(header) + '\n');

  const previous = getGlobalDispatcher();
  const inner: Dispatcher = opts.innerDispatcher ?? previous;
  let seq = 0;
  const captureAll = opts.captureAllHosts ?? false;

  const writeInteraction = (interaction: CassetteInteraction): void => {
    CassetteInteractionSchema.parse(interaction);
    appendFileSync(opts.outputPath, JSON.stringify(interaction) + '\n');
  };

  // Forward through the supplied `inner` dispatcher rather than the
  // composed dispatch chain — this lets callers stack additional
  // dispatchers underneath the recorder (e.g., a redirect dispatcher
  // for fixture-based recordings) and still see all outbound traffic
  // route through that bottom layer.
  const innerDispatch = inner.dispatch.bind(inner);

  const interceptor: Dispatcher.DispatcherComposeInterceptor = (_dispatch) => {
    return function recordingDispatch(dispatchOpts, handler) {
      const url = fullUrl(dispatchOpts);
      const inScope = captureAll || isProviderUrl(url);

      if (!inScope) {
        return innerDispatch(dispatchOpts, handler);
      }

      const method = dispatchOpts.method;
      const headerRecord = headersToRecord(dispatchOpts.headers);

      // Read the outbound body up-front so we can capture + hash it,
      // then rewrite a fresh body for the inner dispatcher. For
      // Readable bodies this consumes the stream; we replace with a
      // Buffer so the request still drains correctly downstream.
      const bodyPromise = readDispatchBody(dispatchOpts.body);

      // Buffer the inbound stream until onComplete fires so we can
      // produce one JSONL line per interaction in dispatch order.
      let capturedStatus = 0;
      let capturedHeaders: Record<string, string> = {};
      const responseChunks: Buffer[] = [];

      const wrappedHandler: Dispatcher.DispatchHandlers = {
        onConnect: handler.onConnect?.bind(handler),
        onError: handler.onError?.bind(handler),
        onUpgrade: handler.onUpgrade?.bind(handler),
        onResponseStarted: handler.onResponseStarted?.bind(handler),
        onBodySent: handler.onBodySent?.bind(handler),
        onHeaders(statusCode, headers, resume, statusText) {
          capturedStatus = statusCode;
          capturedHeaders = normalizeResponseHeaders(headers);
          return handler.onHeaders
            ? handler.onHeaders(statusCode, headers, resume, statusText)
            : true;
        },
        onData(chunk) {
          responseChunks.push(Buffer.from(chunk));
          return handler.onData ? handler.onData(chunk) : true;
        },
        onComplete(trailers) {
          try {
            seq += 1;
            const bodyBuf = bodyBufRef.value;
            const bodyValue = decodeBodyToValue(bodyBuf);
            const normalised = normalizeRequest(method, url, headerRecord, bodyValue, { cwd });
            const bodyHash = hashRequest(normalised);

            // Chunked SSE: store each chunk as one element (string).
            // For non-SSE bodies the array typically has length 1.
            const isEventStream = (capturedHeaders['content-type'] ?? '')
              .toLowerCase()
              .includes('text/event-stream');
            const bodyChunks: unknown[] = isEventStream
              ? responseChunks.map((c) => c.toString('utf8'))
              : [Buffer.concat(responseChunks).toString('utf8')];

            writeInteraction({
              schema_version: 1,
              type: 'interaction',
              seq,
              request: {
                method: normalised.method,
                url: normalised.url,
                headers_normalized: normalised.headers_normalized,
                body_hash: bodyHash,
              },
              response: {
                status: capturedStatus,
                headers: capturedHeaders,
                body_chunks: bodyChunks,
              },
            });
          } catch (err) {
            // Surface as a handler error so the test sees the failure
            // rather than producing a silently-truncated cassette.
            handler.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
          handler.onComplete?.(trailers);
        },
      };

      // Drain the body synchronously enough to keep dispatch ordering
      // stable — we await the body read before forwarding so the seq
      // numbers reflect the order requests were dispatched into the
      // interceptor.
      const bodyBufRef: { value: Buffer } = { value: Buffer.alloc(0) };
      bodyPromise.then(
        (buf) => {
          bodyBufRef.value = buf;
          const forwardedOpts: Dispatcher.DispatchOptions = {
            ...dispatchOpts,
            body: buf.length === 0 ? null : buf,
          };
          innerDispatch(forwardedOpts, wrappedHandler);
        },
        (err) => {
          handler.onError?.(err instanceof Error ? err : new Error(String(err)));
        },
      );

      return true;
    };
  };

  const composed = (inner instanceof Agent ? inner : new Agent()).compose(interceptor);
  setGlobalDispatcher(composed);

  let captureError: Error | undefined;
  try {
    await opts.run();
  } catch (err) {
    captureError = err instanceof Error ? err : new Error(String(err));
  } finally {
    setGlobalDispatcher(previous);
  }

  if (captureError) throw captureError;
}

/**
 * Convenience accessor for tests that want to assert against the
 * recorder's PROVIDER_HOSTS list (e.g., "does this provider get captured?").
 */
export function getProviderHosts(): readonly string[] {
  return PROVIDER_HOSTS;
}
