// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

function setupFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-sse-'));
  const planning = path.join(root, '.swt-planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(
    path.join(planning, 'STATE.md'),
    '# State\n**Project:** ssetest\n**Milestone:** smoke\n\n## Current Phase\nPhase: 1 of 1\n',
  );
  writeFileSync(
    path.join(planning, 'ROADMAP.md'),
    '# ssetest\n\n## Phase 1: Smoke\n\n**Goal:** s\n',
  );
  return root;
}

describe.skip('AC-03: file save → SSE delivery within 500ms', () => {
  let server: DashboardServer | undefined;
  let root: string;

  beforeEach(async () => {
    root = setupFixture();
    server = await createServer({ port: 0, projectRoot: root });
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('saving STATE.md triggers state.changed within 500ms', async () => {
    if (!server) throw new Error('server not started');
    const base = `http://${server.hostname}:${server.port}`;
    const sseRes = await fetch(`${base}/api/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(sseRes.status).toBe(200);
    const body = sseRes.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    try {
      // Allow chokidar to settle on the initial scan
      await new Promise((r) => setTimeout(r, 100));

      const start = Date.now();
      writeFileSync(
        path.join(root, '.swt-planning', 'STATE.md'),
        '# State\n**Project:** ssetest\n**Milestone:** smoke\n\n## Current Phase\nPhase: 1 of 1 (modified)\n',
      );

      const evt = await readUntilEvent(reader, (e) => e.event === 'state.changed', 1500);
      const elapsed = Date.now() - start;
      // AC-03 contract is 500ms; awaitWriteFinish stabilityThreshold=25ms +
      // 50ms debounce + reducer overhead < 200ms typical. 500ms is the budget.
      expect(elapsed).toBeLessThan(500);
      expect(evt.data).toBeDefined();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);
});
