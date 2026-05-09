import { SnapshotEventSchema } from '@swt-labs/dashboard-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServer, type DashboardServer } from '../src/server/index.js';

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

describe('SSE round-trip end-to-end', () => {
  let server: DashboardServer | undefined;

  beforeEach(async () => {
    server = await createServer({ port: 0 });
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('GET /api/events streams an event published via POST /api/_debug/emit within 250ms', async () => {
    if (!server) throw new Error('server not started');
    const base = `http://${server.hostname}:${server.port}`;

    const sseRes = await fetch(`${base}/api/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = sseRes.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      // Give the SSE handler a moment to subscribe before we publish.
      await new Promise((r) => setTimeout(r, 25));

      const fixture = {
        type: 'agent.spawn' as const,
        ts: '2026-05-09T10:00:00Z',
        agent: 'scout',
        phase: '01',
        plan: null,
      };

      const start = Date.now();
      const emitRes = await fetch(`${base}/api/_debug/emit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fixture),
      });
      expect(emitRes.status).toBe(200);
      const emitJson: unknown = await emitRes.json();
      expect(emitJson).toEqual({ queued: true });

      const evt = await readUntilEvent(reader, (e) => e.event === 'agent.spawn', 250);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(250);

      expect(evt.data).toBeDefined();
      const parsed = SnapshotEventSchema.parse(JSON.parse(evt.data ?? '{}'));
      expect(parsed.type).toBe('agent.spawn');
      if (parsed.type === 'agent.spawn') {
        expect(parsed.agent).toBe('scout');
        expect(parsed.phase).toBe('01');
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('rejects malformed body on /api/_debug/emit with 400', async () => {
    if (!server) throw new Error('server not started');
    const res = await fetch(`http://${server.hostname}:${server.port}/api/_debug/emit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'mystery', ts: 'now' }),
    });
    expect(res.status).toBe(400);
  });
});
