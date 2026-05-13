/**
 * Cassette replayer.
 *
 * Reads a JSONL cassette from disk, installs an undici dispatcher
 * interceptor that matches outbound requests by `body_hash` against the
 * recorded interactions, and re-emits the recorded response chunks
 * preserving stream framing. Mismatches throw a
 * `RequestNotInCassetteError` with a diagnostic excerpt.
 *
 * Per TDD2 §14.7.2 + Phase 5 plan 05-01 task T2.
 */

import { existsSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import {
  Agent,
  Dispatcher,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';

import {
  CassetteHeaderSchema,
  CassetteInteractionSchema,
  type CassetteHeader,
  type CassetteInteraction,
} from './format.js';
import { hashRequest, normalizeRequest } from './normalize.js';
import { CassetteSeqError, RequestNotInCassetteError } from './errors.js';

export interface ReplayHandle {
  /** Tear down the interceptor; restores the previous undici dispatcher. */
  uninstall(): void;
  /** Read access to the cassette header (recorded provider, model, etc.). */
  header: CassetteHeader;
  /** Read access to the interaction list (PR-07 + PR-09 inspect this). */
  interactions: ReadonlyArray<CassetteInteraction>;
}

export class CassetteNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(
      `Cassette not found: ${path}. Record it first via the recorder script — see docs/operations/cassette-recording.md.`,
    );
    this.name = 'CassetteNotFoundError';
  }
}

export class CassetteUnsealedError extends Error {
  constructor(public readonly path: string) {
    super(
      `Cassette ${path} has cwd_redacted: false in its header. Refusing to load — the recorder must strip cwd paths before the cassette is committed.`,
    );
    this.name = 'CassetteUnsealedError';
  }
}

/**
 * Load a cassette file from disk and validate its structure. Returns the
 * parsed header + interactions. Throws `CassetteNotFoundError` if the
 * file is missing, `CassetteUnsealedError` if the header reports
 * `cwd_redacted: false`, or a Zod validation error if the schema doesn't
 * match.
 */
export function loadCassette(path: string): {
  header: CassetteHeader;
  interactions: CassetteInteraction[];
} {
  if (!existsSync(path)) throw new CassetteNotFoundError(path);

  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`Cassette ${path} is empty.`);
  }

  const firstLineRaw = lines[0];
  if (firstLineRaw === undefined) {
    throw new Error(`Cassette ${path} is empty after filter.`);
  }
  const firstLine: unknown = JSON.parse(firstLineRaw);
  const headerCandidate =
    typeof firstLine === 'object' && firstLine !== null
      ? (firstLine as Record<string, unknown>)
      : {};
  if (headerCandidate['type'] !== 'header') {
    throw new Error(
      `Cassette ${path} first line is not a header (got type=${String(headerCandidate['type'])}).`,
    );
  }

  const header = CassetteHeaderSchema.parse(firstLine);
  if (header.cwd_redacted !== true) throw new CassetteUnsealedError(path);

  const interactions: CassetteInteraction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const parsed: unknown = JSON.parse(line);
    interactions.push(CassetteInteractionSchema.parse(parsed));
  }

  // Sequence numbers should be monotonic 1..N — guard against accidental
  // reordering in version-controlled cassettes.
  for (let i = 0; i < interactions.length; i++) {
    const expected = i + 1;
    const interaction = interactions[i];
    if (interaction === undefined) continue;
    const actual = interaction.seq;
    if (actual !== expected) {
      throw new Error(
        `Cassette ${path} interaction #${i} has seq=${actual}, expected ${expected}.`,
      );
    }
  }

  return { header, interactions };
}

export interface InstallReplayOptions {
  /**
   * Optional cwd to strip from outgoing requests at match-time. Must equal
   * the cwd the cassette was recorded against, otherwise body hashes
   * won't line up. Defaults to `process.cwd()`.
   */
  readonly cwd?: string;
  /**
   * Enforce strict monotonic seq order. Defaults to `true`. When `true`
   * the replayer throws `CassetteSeqError` if a matching interaction is
   * found but its `seq` is not the next expected. Tests that intentionally
   * re-issue the same request multiple times (e.g., retry probes) can pass
   * `false` to skip the seq gate.
   */
  readonly enforceSeq?: boolean;
}

/**
 * Convert an undici dispatch body into a Buffer. See recorder.ts —
 * `undici.fetch` POST bodies arrive as bare async iterables, not
 * `Readable` instances, so we must handle that shape explicitly.
 */
async function readDispatchBody(body: Dispatcher.DispatchOptions['body']): Promise<Buffer> {
  if (body === null || body === undefined) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Buffer) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
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
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
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

function decodeBodyToValue(buf: Buffer): unknown {
  if (buf.length === 0) return '';
  const text = buf.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Encode response headers from a plain `Record<string, string>` (as
 * stored in the cassette) back into the `Buffer[]` shape undici's
 * `onHeaders` consumer expects: alternating key/value byte buffers.
 */
function encodeHeadersForUndici(headers: Record<string, string>): Buffer[] {
  const out: Buffer[] = [];
  for (const [k, v] of Object.entries(headers)) {
    out.push(Buffer.from(k, 'utf8'));
    out.push(Buffer.from(v, 'utf8'));
  }
  return out;
}

/**
 * Install a cassette replayer. Returns a handle the caller uses to
 * uninstall when the test ends. Multiple cassettes cannot be installed
 * simultaneously — install / uninstall is a single-slot lifecycle.
 *
 * Match strategy: each outbound request's normalised body is hashed
 * via `hashRequest()` and looked up in a `body_hash → interaction` map
 * built from the cassette. On hit, the recorded response is re-emitted
 * chunk-by-chunk so stream consumers see the same framing the recorder
 * observed. On miss, `RequestNotInCassetteError` is raised through the
 * handler's `onError` path with a body excerpt + the set of recorded
 * hashes for diagnostic output.
 */
export function installReplay(path: string, opts: InstallReplayOptions = {}): ReplayHandle {
  const { header, interactions } = loadCassette(path);
  const cwd = opts.cwd ?? process.cwd();
  const enforceSeq = opts.enforceSeq ?? true;

  const interactionsByHash = new Map<string, CassetteInteraction>();
  for (const i of interactions) interactionsByHash.set(i.request.body_hash, i);
  const recordedHashes = Array.from(interactionsByHash.keys());

  const previous = getGlobalDispatcher();
  let nextExpectedSeq = 1;

  const interceptor: Dispatcher.DispatcherComposeInterceptor = (_dispatch) => {
    return function replayingDispatch(dispatchOpts, handler) {
      const method = dispatchOpts.method;
      const url = fullUrl(dispatchOpts);
      const headerRecord = headersToRecord(dispatchOpts.headers);

      readDispatchBody(dispatchOpts.body).then(
        (bodyBuf) => {
          try {
            const bodyValue = decodeBodyToValue(bodyBuf);
            const normalised = normalizeRequest(method, url, headerRecord, bodyValue, { cwd });
            const requestedHash = hashRequest(normalised);
            const interaction = interactionsByHash.get(requestedHash);

            if (!interaction) {
              const excerpt =
                typeof bodyValue === 'string'
                  ? bodyValue
                  : JSON.stringify(bodyValue);
              const err = new RequestNotInCassetteError(requestedHash, excerpt, recordedHashes);
              handler.onError?.(err);
              return;
            }

            if (enforceSeq && interaction.seq !== nextExpectedSeq) {
              const err = new CassetteSeqError(nextExpectedSeq, interaction.seq);
              handler.onError?.(err);
              return;
            }
            nextExpectedSeq = Math.max(nextExpectedSeq, interaction.seq + 1);

            // Re-emit recorded response. undici handler protocol:
            //   onConnect(abort) → onHeaders(status, headers, resume, statusText)
            //   → onData(chunk) [N times] → onComplete(trailers)
            handler.onConnect?.(() => {});
            const status = interaction.response.status;
            const statusText = status === 200 ? 'OK' : '';
            const headersForUndici = encodeHeadersForUndici(interaction.response.headers);
            const resume = () => {};
            handler.onHeaders?.(status, headersForUndici, resume, statusText);
            for (const chunk of interaction.response.body_chunks) {
              const buf =
                typeof chunk === 'string'
                  ? Buffer.from(chunk, 'utf8')
                  : Buffer.from(JSON.stringify(chunk), 'utf8');
              handler.onData?.(buf);
            }
            handler.onComplete?.([]);
          } catch (err) {
            handler.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        },
        (err) => {
          handler.onError?.(err instanceof Error ? err : new Error(String(err)));
        },
      );

      return true;
    };
  };

  const composed = new Agent().compose(interceptor);
  setGlobalDispatcher(composed);

  return {
    header,
    interactions: Object.freeze([...interactions]),
    uninstall() {
      setGlobalDispatcher(previous);
    },
  };
}
