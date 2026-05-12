import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerWorktreesRoute } from '../src/server/routes/worktrees.js';

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

function makeEntry(taskId: string, from: string, to: string, ts: string): string {
  return (
    JSON.stringify({
      timestamp: ts,
      taskId,
      from,
      to,
      details: {},
    }) + '\n'
  );
}

describe('registerWorktreesRoute — GET /api/worktrees/sse', () => {
  let root: string;
  let journalDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'swt-worktrees-route-'));
    journalDir = path.join(root, '.swt-planning', 'journal');
    mkdirSync(journalDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore — best effort
    }
  });

  it('emits worktree.snapshot with the last entry per wt-*.jsonl file on connect', async () => {
    const fileA = path.join(journalDir, 'wt-T-001.jsonl');
    writeFileSync(
      fileA,
      makeEntry('T-001', 'none', 'created', '2026-05-12T10:00:00.000Z') +
        makeEntry('T-001', 'created', 'claimed', '2026-05-12T10:00:01.000Z'),
    );
    const fileB = path.join(journalDir, 'wt-T-002.jsonl');
    writeFileSync(fileB, makeEntry('T-002', 'none', 'created', '2026-05-12T10:00:02.000Z'));

    const app = new Hono();
    registerWorktreesRoute(app, root);

    const res = await app.request('/api/worktrees/sse', {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'worktree.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as {
        type: string;
        worktrees: Record<string, { taskId: string; from: string; to: string }>;
      };
      expect(data.type).toBe('worktree.snapshot');
      expect(data.worktrees['T-001']?.to).toBe('claimed'); // last entry of file A
      expect(data.worktrees['T-002']?.to).toBe('created'); // only entry of file B
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('emits worktree.update when a new journal line is appended', async () => {
    const file = path.join(journalDir, 'wt-T-003.jsonl');
    writeFileSync(file, makeEntry('T-003', 'none', 'created', '2026-05-12T11:00:00.000Z'));

    const app = new Hono();
    registerWorktreesRoute(app, root);
    const res = await app.request('/api/worktrees/sse', {
      headers: { accept: 'text/event-stream' },
    });
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      // Drain the initial snapshot frame first so we don't false-positive on it.
      await readUntilEvent(reader, (e) => e.event === 'worktree.snapshot', 1000);

      // Give the chokidar tailer a moment to settle past its initial scan.
      await new Promise((r) => setTimeout(r, 100));

      appendFileSync(file, makeEntry('T-003', 'created', 'claimed', '2026-05-12T11:00:01.000Z'));

      const update = await readUntilEvent(reader, (e) => e.event === 'worktree.update', 2000);
      const data = JSON.parse(update.data ?? '{}') as {
        type: string;
        entry: { taskId: string; to: string };
      };
      expect(data.type).toBe('worktree.update');
      expect(data.entry.taskId).toBe('T-003');
      expect(data.entry.to).toBe('claimed');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('returns 503 when projectRoot is null (greenfield daemon)', async () => {
    const app = new Hono();
    registerWorktreesRoute(app, null);
    const res = await app.request('/api/worktrees/sse', {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(503);
  });

  it('skips corrupt JSON lines without halting the snapshot read', async () => {
    const file = path.join(journalDir, 'wt-T-004.jsonl');
    writeFileSync(
      file,
      `${makeEntry('T-004', 'none', 'created', '2026-05-12T12:00:00.000Z').trimEnd()}\nNOT JSON\n${makeEntry('T-004', 'created', 'claimed', '2026-05-12T12:00:01.000Z').trimEnd()}\n`,
    );

    const app = new Hono();
    registerWorktreesRoute(app, root);
    const res = await app.request('/api/worktrees/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'worktree.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as {
        worktrees: Record<string, { to: string }>;
      };
      // Last valid entry wins; the corrupt middle line is skipped.
      expect(data.worktrees['T-004']?.to).toBe('claimed');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);
});
