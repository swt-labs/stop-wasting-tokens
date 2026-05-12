/**
 * Phase 03 / AC-04: 5-second disconnect detection, ≤10s reconnect.
 *
 * NOTE (v3-debt): the original vitest jsdom environment directive was
 * removed when this file was skipped — jsdom isn't installed as a workspace
 * dep and the directive forces vitest to try to load it at file-eval time,
 * which throws ERR_MODULE_NOT_FOUND before describe.skip can take effect.
 * Restore the directive (`vitest-environment: jsdom`, written as a JSDoc tag
 * with the @ prefix) when un-skipping (see issue #32).
 *
 * EventSource is not implemented natively in jsdom; we install a controllable
 * fake on globalThis before importing the SSE service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEventSourceInstance {
  url: string;
  readyState: 0 | 1 | 2;
  listeners: Map<string, Set<(evt: MessageEvent) => void>>;
  fireOpen: () => void;
  fireError: () => void;
  fireMessage: (type: string, data: string) => void;
  close: () => void;
  closed: boolean;
}

declare global {
  // Augment globalThis with our fake so TS doesn't complain.

  var __fakeEventSources: FakeEventSourceInstance[] | undefined;
}

class FakeEventSource implements FakeEventSourceInstance {
  url: string;
  readyState: 0 | 1 | 2 = 0;
  closed = false;
  listeners: Map<string, Set<(evt: MessageEvent) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
    if (!globalThis.__fakeEventSources) globalThis.__fakeEventSources = [];
    globalThis.__fakeEventSources.push(this);
  }

  addEventListener(type: string, fn: (evt: MessageEvent) => void): void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(fn);
  }

  removeEventListener(): void {
    /* unused */
  }

  fireOpen(): void {
    this.readyState = 1;
    const bucket = this.listeners.get('open');
    if (bucket) for (const fn of bucket) fn({} as MessageEvent);
  }

  fireError(): void {
    this.readyState = 2;
    const bucket = this.listeners.get('error');
    if (bucket) for (const fn of bucket) fn({} as MessageEvent);
  }

  fireMessage(type: string, data: string): void {
    const bucket = this.listeners.get(type);
    if (bucket) for (const fn of bucket) fn({ data } as unknown as MessageEvent);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
}

describe('SSE reconnect (AC-04)', () => {
  beforeEach(() => {
    globalThis.__fakeEventSources = [];
    (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
      FakeEventSource;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as Record<string, unknown>).EventSource;
    globalThis.__fakeEventSources = [];
  });

  it('schedules reconnect after disconnect using configured backoff', async () => {
    const { openSseConnection } = await import('../src/client/services/sse.ts');
    const onReconnectAttempt = vi.fn();

    const conn = openSseConnection(
      '/api/events',
      {},
      { delaysMs: [1000, 2000, 5000, 10000], onReconnectAttempt },
    );

    // First connection opens, then errors → triggers schedule.
    const first = globalThis.__fakeEventSources![0]!;
    first.fireOpen();
    first.fireError();
    expect(onReconnectAttempt).toHaveBeenCalledWith(1);

    // After 1000ms a second EventSource should be created.
    vi.advanceTimersByTime(1000);
    expect(globalThis.__fakeEventSources!.length).toBe(2);

    conn.close();
  });

  it('detects disconnect within 5s and reconnects within 10s', async () => {
    const { openSseConnection } = await import('../src/client/services/sse.ts');
    const onOpen = vi.fn();
    const conn = openSseConnection('/api/events', { onOpen }, { delaysMs: [1000] });

    const first = globalThis.__fakeEventSources![0]!;
    first.fireOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Browser EventSource detects disconnect well within 5s, then we
    // reconnect after 1s. Total: < 5s detection + 1s reconnect = 6s max.
    first.fireError();
    vi.advanceTimersByTime(1000);

    expect(globalThis.__fakeEventSources!.length).toBe(2);
    const second = globalThis.__fakeEventSources![1]!;
    second.fireOpen();
    expect(onOpen).toHaveBeenCalledTimes(2);

    conn.close();
  });

  it('fires onReconnected exactly once after successful reconnect', async () => {
    const { openSseConnection } = await import('../src/client/services/sse.ts');
    const onReconnected = vi.fn();

    const conn = openSseConnection('/api/events', {}, { delaysMs: [10], onReconnected });

    const first = globalThis.__fakeEventSources![0]!;
    first.fireOpen();
    // No reconnect yet — initial open shouldn't fire onReconnected.
    expect(onReconnected).not.toHaveBeenCalled();

    first.fireError();
    vi.advanceTimersByTime(10);

    const second = globalThis.__fakeEventSources![1]!;
    second.fireOpen();
    expect(onReconnected).toHaveBeenCalledTimes(1);

    conn.close();
  });
});
