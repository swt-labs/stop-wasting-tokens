import type { TelemetryEvent } from './events.js';
import type { Sender } from './sender.js';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_DELAY_MS = 1000;
const RETRY_JITTER_MS = 200;

export interface HttpSenderOptions {
  /** Telemetry ingest URL (POST target). */
  readonly endpoint: string;
  /** Override the fetch implementation (default: globalThis.fetch). */
  readonly fetchImpl?: typeof globalThis.fetch;
  /** Override the AbortSignal timeout (default 5000 ms). */
  readonly timeoutMs?: number;
  /** Optional warning sink — invoked on transient failures + drop-after-exhaust. */
  readonly onWarning?: (msg: string) => void;
  /** Override the base retry delay (default 1000 ms). Tests bypass jitter via 0. */
  readonly retryDelayMs?: number;
  /** Inject deterministic jitter for tests; default returns ±200ms uniform. */
  readonly jitterImpl?: () => number;
  /** Inject setTimeout for fake-timer tests. */
  readonly setTimeoutImpl?: typeof setTimeout;
}

/**
 * Production telemetry Sender backed by HTTP POST.
 *
 * - POSTs `{events: [...]}` JSON to `endpoint` with a 5-second AbortSignal timeout.
 * - 2xx → resolves.
 * - 5xx, network error, or timeout → wait `retryDelayMs ± jitter` and retry once.
 *   If second attempt fails, log warning + resolve silently (telemetry must never throw).
 * - 4xx → no retry; log warning + resolve silently.
 *
 * Privacy: no User-Agent override, no auth headers, no machine identifiers.
 * Events themselves are sanitized upstream by TelemetryClient before reaching here.
 */
export class HttpSender implements Sender {
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;
  readonly #onWarning: (msg: string) => void;
  readonly #jitter: () => number;
  readonly #setTimeout: typeof setTimeout;

  constructor(opts: HttpSenderOptions) {
    this.#endpoint = opts.endpoint;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.#onWarning = opts.onWarning ?? ((): void => undefined);
    this.#jitter = opts.jitterImpl ?? defaultJitter;
    this.#setTimeout = opts.setTimeoutImpl ?? setTimeout;
  }

  async send(events: readonly TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;

    const body = JSON.stringify({ events });

    const firstAttempt = await this.#postOnce(body);
    if (firstAttempt.ok) return;

    if (firstAttempt.kind === 'client-4xx') {
      this.#onWarning(firstAttempt.reason);
      return;
    }

    this.#onWarning(`telemetry first attempt failed: ${firstAttempt.reason}`);

    await this.#delay(this.#retryDelayMs + this.#jitter());

    const secondAttempt = await this.#postOnce(body);
    if (secondAttempt.ok) return;

    this.#onWarning(`telemetry retry failed: ${secondAttempt.reason}`);
  }

  async #postOnce(body: string): Promise<PostOutcome> {
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (response.ok) return { ok: true };
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, kind: 'client-4xx', reason: `HTTP ${response.status}` };
      }
      return { ok: false, kind: 'server-5xx', reason: `HTTP ${response.status}` };
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      return { ok: false, kind: 'network', reason };
    }
  }

  #delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#setTimeout(resolve, Math.max(0, ms));
    });
  }
}

type PostOutcome =
  | { ok: true }
  | { ok: false; kind: 'client-4xx' | 'server-5xx' | 'network'; reason: string };

function defaultJitter(): number {
  return Math.floor((Math.random() * 2 - 1) * RETRY_JITTER_MS);
}
