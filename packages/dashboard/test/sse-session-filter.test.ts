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

async function readEventsFor(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  durationMs: number,
): Promise<ParsedSse[]> {
  const decoder = new TextDecoder();
  let buffer = '';
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const remaining = durationMs - (Date.now() - start);
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), Math.max(remaining, 1)),
      ),
    ]);
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });
  }
  return parseSseChunk(buffer);
}

describe('SSE ?session_id= filter', () => {
  let server: DashboardServer | undefined;

  beforeEach(async () => {
    server = await createServer({ port: 0 });
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('without ?session_id, the client receives all events (firehose)', async () => {
    if (!server) throw new Error('server not started');
    const base = `http://${server.hostname}:${server.port}`;
    const sseRes = await fetch(`${base}/api/events`, {
      headers: { accept: 'text/event-stream' },
    });
    const reader = sseRes.body!.getReader();
    try {
      await new Promise((r) => setTimeout(r, 25));
      // Emit one global event (no session_id) and one with a session_id.
      server.bus.publish({
        type: 'agent.spawn',
        ts: '2026-05-09T10:00:00Z',
        agent: 'scout',
        phase: '01',
        plan: null,
      });
      server.bus.publish({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:01Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'q?',
      });
      const events = await readEventsFor(reader, 100);
      const types = events.map((e) => e.event).filter(Boolean);
      expect(types).toContain('agent.spawn');
      expect(types).toContain('agent.prompt');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });

  it('with ?session_id=sess-A, the client receives only matching session events + global events', async () => {
    if (!server) throw new Error('server not started');
    const base = `http://${server.hostname}:${server.port}`;
    const sseRes = await fetch(`${base}/api/events?session_id=sess-A`, {
      headers: { accept: 'text/event-stream' },
    });
    const reader = sseRes.body!.getReader();
    try {
      await new Promise((r) => setTimeout(r, 25));
      // Global event: should pass.
      server.bus.publish({
        type: 'agent.spawn',
        ts: '2026-05-09T10:00:00Z',
        agent: 'scout',
        phase: '01',
        plan: null,
      });
      // Matching session: should pass.
      server.bus.publish({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:01Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'A',
      });
      // Different session: should be filtered out.
      server.bus.publish({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:02Z',
        session_id: 'sess-B',
        prompt_id: 'p-2',
        subtype: 'clarification',
        question: 'B',
      });
      const events = await readEventsFor(reader, 100);
      const promptDataValues = events
        .filter((e) => e.event === 'agent.prompt')
        .map((e) => JSON.parse(e.data ?? '{}'));
      expect(promptDataValues).toHaveLength(1);
      expect(promptDataValues[0].session_id).toBe('sess-A');
      // Global event still arrives:
      const types = events.map((e) => e.event);
      expect(types).toContain('agent.spawn');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });
});
