import type { EventName, EventProperties, TelemetryEvent } from './events.js';
import { sanitize } from './sanitize.js';
import type { Sender } from './sender.js';

const FLUSH_DEBOUNCE_MS = 5000;

export interface TelemetryClientOptions {
  readonly sender: Sender;
  readonly enabled: boolean;
  readonly anonymousId: string | null;
  readonly now?: () => number;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
  readonly onWarning?: (msg: string) => void;
}

export class TelemetryClient {
  private readonly sender: Sender;
  private readonly enabled: boolean;
  private readonly anonymousId: string | null;
  private readonly now: () => number;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private readonly onWarning?: (msg: string) => void;

  private buffer: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: TelemetryClientOptions) {
    this.sender = opts.sender;
    this.enabled = opts.enabled;
    this.anonymousId = opts.anonymousId;
    this.now = opts.now ?? Date.now;
    this.setTimeoutImpl = opts.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = opts.clearTimeoutImpl ?? clearTimeout;
    this.onWarning = opts.onWarning;
  }

  send<E extends EventName>(name: E, properties: EventProperties[E]): void {
    if (!this.enabled || this.anonymousId === null) return;

    const sanitized = sanitize(name, properties, { onWarning: this.onWarning });
    this.buffer.push({
      name,
      properties: sanitized,
      anonymous_id: this.anonymousId,
      at: this.now(),
    });
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      this.clearTimeoutImpl(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      await this.sender.send(batch);
    } catch {
      // drop on send failure — no retries in v1.0
    }
  }

  disable(): void {
    if (this.flushTimer) {
      this.clearTimeoutImpl(this.flushTimer);
      this.flushTimer = null;
    }
    this.buffer = [];
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const timer = this.setTimeoutImpl(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    this.flushTimer = timer;
  }
}
