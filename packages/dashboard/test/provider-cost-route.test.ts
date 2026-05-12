/**
 * `/api/provider-cost/sse` route tests per Plan 05-01 PR-43.
 */

import type { MeterRecord, MeterSnapshot, MeterUpdate, TokenMeter } from '@swt-labs/runtime';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerProviderCostRoute } from '../src/server/routes/provider-cost.js';

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
    milestone: 'M5',
    phase: '05',
    task_id: 'T-provider-cost-route',
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

describe('registerProviderCostRoute — GET /api/provider-cost/sse', () => {
  it('emits provider-cost.snapshot with empty rows when getMeter() returns null', async () => {
    const app = new Hono();
    registerProviderCostRoute(app, () => null);
    const res = await app.request('/api/provider-cost/sse', {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'provider-cost.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as { rows: unknown[] };
      expect(data.rows).toEqual([]);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('emits per-provider rows when meter is wired', async () => {
    const records: MeterRecord[] = [
      makeRecord({ provider: 'anthropic', cost_usd: 7.5, input: 1000 }),
      makeRecord({ provider: 'openai', cost_usd: 2.5, input: 500 }),
    ];
    const meter = makeMeterStub(records);
    const app = new Hono();
    registerProviderCostRoute(app, () => meter);
    const res = await app.request('/api/provider-cost/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'provider-cost.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as {
        rows: Array<{ provider: string; cost_usd: number; share_pct: number }>;
      };
      expect(data.rows).toHaveLength(2);
      // Sorted by cost desc — anthropic first.
      expect(data.rows[0]?.provider).toBe('anthropic');
      expect(data.rows[0]?.cost_usd).toBe(7.5);
      expect(data.rows[0]?.share_pct).toBeCloseTo(75);
      expect(data.rows[1]?.provider).toBe('openai');
      expect(data.rows[1]?.share_pct).toBeCloseTo(25);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('re-emits a fresh snapshot frame when METER_UPDATED fires', async () => {
    const records: MeterRecord[] = [makeRecord({ provider: 'anthropic', cost_usd: 1.0 })];
    const meter = makeMeterStub(records);
    const app = new Hono();
    registerProviderCostRoute(app, () => meter);
    const res = await app.request('/api/provider-cost/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      // Drain initial snapshot.
      await readUntilEvent(reader, (e) => e.event === 'provider-cost.snapshot', 1000);

      // Inject a fallback-fired turn against a second provider.
      records.push(makeRecord({ provider: 'openai', cost_usd: 0.5 }));
      await new Promise((r) => setTimeout(r, 50));
      meter.trigger();

      const next = await readUntilEvent(
        reader,
        (e) => {
          if (e.event !== 'provider-cost.snapshot') return false;
          const d = JSON.parse(e.data ?? '{}') as { rows?: Array<{ provider: string }> };
          return (d.rows?.length ?? 0) === 2;
        },
        2000,
      );
      const data = JSON.parse(next.data ?? '{}') as {
        rows: Array<{ provider: string; cost_usd: number }>;
      };
      expect(data.rows.map((r) => r.provider).sort()).toEqual(['anthropic', 'openai']);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);
});
