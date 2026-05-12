/**
 * `/api/cache-hits/sse` route tests per Plan 04-01 PR-33.
 *
 * Two paths exercised:
 *   1. `getMeter() === null` (greenfield daemon / no meter wired):
 *      emit a single `cache-hit.snapshot` frame with empty summaries.
 *   2. `getMeter() !== null` (wired): emit the computed summaries +
 *      re-emit on every `METER_UPDATED` event.
 */

import type { MeterRecord, MeterSnapshot, MeterUpdate, TokenMeter } from '@swt-labs/runtime';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerCacheHitsRoute } from '../src/server/routes/cache-hits.js';

interface ParsedSse {
  event?: string;
  data?: string;
}

function parseSseChunk(chunk: string): ParsedSse[] {
  const blocks = chunk.split(/\n\n/);
  const parsed: ParsedSse[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const out: ParsedSse = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) out.event = line.slice(6).trim();
      else if (line.startsWith('data:')) out.data = (out.data ?? '') + line.slice(5).trim();
    }
    if (out.event || out.data) parsed.push(out);
  }
  return parsed;
}

async function readUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  matcher: (evt: ParsedSse) => boolean,
  timeoutMs: number,
): Promise<ParsedSse> {
  const decoder = new TextDecoder();
  const start = Date.now();
  let buffer = '';
  while (Date.now() - start < timeoutMs) {
    const { value, done } = await reader.read();
    if (done) throw new Error('SSE stream closed before matching event arrived');
    buffer += decoder.decode(value, { stream: true });
    for (const evt of parseSseChunk(buffer)) {
      if (matcher(evt)) return evt;
    }
  }
  throw new Error(
    `SSE matcher did not fire within ${timeoutMs}ms; buffer: ${buffer.slice(0, 200)}`,
  );
}

function makeRecord(overrides: Partial<MeterRecord>): MeterRecord {
  return {
    timestamp: '2026-05-12T10:00:00.000Z',
    milestone: 'M4',
    phase: '04',
    task_id: 'T-cache-hit-route',
    role: 'dev',
    tier: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    turn: 1,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost_usd: 0,
    ...overrides,
  };
}

function makeMeterStub(records: MeterRecord[]): TokenMeter & { trigger: () => void } {
  const listeners: Array<(e: MeterUpdate) => void> = [];
  const meter: TokenMeter = {
    record: () => undefined,
    snapshot: (): MeterSnapshot => ({
      totals: {
        input: records.reduce((a, r) => a + r.input, 0),
        output: records.reduce((a, r) => a + r.output, 0),
        cacheRead: records.reduce((a, r) => a + r.cacheRead, 0),
        cacheWrite: records.reduce((a, r) => a + r.cacheWrite, 0),
        cost_usd: records.reduce((a, r) => a + r.cost_usd, 0),
      },
      records,
    }),
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
  return Object.assign(meter, {
    trigger: () => {
      const last = records[records.length - 1];
      if (last === undefined) return;
      for (const l of listeners) l({ type: 'METER_UPDATED', record: last });
    },
  });
}

describe('registerCacheHitsRoute — GET /api/cache-hits/sse', () => {
  it('emits cache-hit.snapshot with empty summaries when getMeter() returns null', async () => {
    const app = new Hono();
    registerCacheHitsRoute(app, () => null);
    const res = await app.request('/api/cache-hits/sse', {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'cache-hit.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as {
        type: string;
        summaries: unknown[];
      };
      expect(data.type).toBe('cache-hit.snapshot');
      expect(data.summaries).toEqual([]);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('emits computed summaries from the meter when wired', async () => {
    const records: MeterRecord[] = [
      makeRecord({ provider: 'anthropic', cacheRead: 8000, input: 1500, cacheWrite: 500 }),
    ];
    const meter = makeMeterStub(records);
    const app = new Hono();
    registerCacheHitsRoute(app, () => meter);
    const res = await app.request('/api/cache-hits/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'cache-hit.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as {
        summaries: Array<{ provider: string; ratio: number; cacheRead: number }>;
      };
      expect(data.summaries).toHaveLength(1);
      expect(data.summaries[0]?.provider).toBe('anthropic');
      expect(data.summaries[0]?.cacheRead).toBe(8000);
      // 8000 / (8000 + 500 + 1500) = 0.8
      expect(data.summaries[0]?.ratio).toBeCloseTo(0.8);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('re-emits a fresh snapshot frame when METER_UPDATED fires', async () => {
    const records: MeterRecord[] = [
      makeRecord({ provider: 'anthropic', cacheRead: 0, input: 100 }),
    ];
    const meter = makeMeterStub(records);
    const app = new Hono();
    registerCacheHitsRoute(app, () => meter);
    const res = await app.request('/api/cache-hits/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      // Drain the initial snapshot frame.
      await readUntilEvent(reader, (e) => e.event === 'cache-hit.snapshot', 1000);

      // Mutate the underlying records + fire METER_UPDATED.
      records.push(makeRecord({ provider: 'anthropic', cacheRead: 700 }));
      await new Promise((r) => setTimeout(r, 50));
      meter.trigger();

      // Next snapshot frame should reflect the new cacheRead total.
      const next = await readUntilEvent(
        reader,
        (e) => {
          if (e.event !== 'cache-hit.snapshot') return false;
          const d = JSON.parse(e.data ?? '{}') as {
            summaries?: Array<{ cacheRead: number }>;
          };
          return (d.summaries?.[0]?.cacheRead ?? 0) === 700;
        },
        2000,
      );
      const data = JSON.parse(next.data ?? '{}') as {
        summaries: Array<{ provider: string; cacheRead: number; ratio: number }>;
      };
      expect(data.summaries[0]?.cacheRead).toBe(700);
      expect(data.summaries[0]?.ratio).toBeCloseTo(700 / (700 + 0 + 100));
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);
});
