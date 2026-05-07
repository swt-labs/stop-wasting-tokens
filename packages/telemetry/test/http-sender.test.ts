import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TelemetryEvent } from '../src/events.js';
import { HttpSender } from '../src/http-sender.js';

const ENDPOINT = 'https://telemetry.test/ingest';

const event: TelemetryEvent = {
  name: 'session_start',
  properties: {},
  anonymous_id: '00000000-0000-0000-0000-000000000001',
  at: 1000,
};

function fetchReturning(status: number): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
  }) as typeof globalThis.fetch;
}

function makeSender(
  opts: Partial<{
    fetchImpl: typeof globalThis.fetch;
    onWarning: (msg: string) => void;
    retryDelayMs: number;
  }> = {},
): HttpSender {
  return new HttpSender({
    endpoint: ENDPOINT,
    fetchImpl: opts.fetchImpl ?? fetchReturning(200),
    retryDelayMs: opts.retryDelayMs ?? 0,
    jitterImpl: () => 0,
    onWarning: opts.onWarning ?? ((): void => undefined),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HttpSender', () => {
  it('happy path: single 200 response → resolves; fetch called once', async () => {
    const fetchMock = fetchReturning(200);
    const sender = makeSender({ fetchImpl: fetchMock });

    await sender.send([event]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [event] }),
      }),
    );
  });

  it('5xx + retry succeeds: first 503, second 200 → resolves; fetch called twice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: '503' })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });
    const sender = makeSender({ fetchImpl: fetchMock as unknown as typeof globalThis.fetch });

    await sender.send([event]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5xx + retry fails: both 503 → resolves silently; onWarning called twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: '503' });
    const onWarning = vi.fn();
    const sender = makeSender({
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
      onWarning,
    });

    await sender.send([event]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onWarning).toHaveBeenCalledTimes(2);
  });

  it('4xx: returns 400 → resolves silently; fetch called once (no retry); onWarning once', async () => {
    const fetchMock = fetchReturning(400);
    const onWarning = vi.fn();
    const sender = makeSender({ fetchImpl: fetchMock, onWarning });

    await sender.send([event]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('400'));
  });

  it('network error + retry succeeds: first throws, second 200 → resolves; fetch called twice', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network unreachable'))
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });
    const sender = makeSender({ fetchImpl: fetchMock as unknown as typeof globalThis.fetch });

    await sender.send([event]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('empty events array: resolves without calling fetch', async () => {
    const fetchMock = fetchReturning(200);
    const sender = makeSender({ fetchImpl: fetchMock });

    await sender.send([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
