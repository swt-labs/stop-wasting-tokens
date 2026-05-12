/**
 * `/api/tpac/sse` route tests per Plan 04-01 PR-37.
 *
 *   1. `projectRoot === null` → emit a `tpac.snapshot` frame with
 *      `reports: []`.
 *   2. `.tpac/` directory missing → empty reports array (no crash).
 *   3. Populated `.tpac/*.json` → reports parsed + sorted by
 *      recorded_at ascending.
 *   4. Corrupt JSON / schema-invalid files skipped without halting.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { TpacReport } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerTpacRoute } from '../src/server/routes/tpac.js';

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

function makeReport(overrides: Partial<TpacReport>): TpacReport {
  return {
    schema_version: 1,
    milestone: 'M2',
    fixture: 'ref-fastapi-empty',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    tpac_input: 100_000,
    tpac_output: 20_000,
    tpac_total: 120_000,
    criteria_satisfied: 5,
    tokens_per_criterion: 24_000,
    recorded_at: '2026-05-12T10:00:00.000Z',
    ...overrides,
  };
}

interface Fixture {
  root: string;
  tpacDir: string;
}

function setupFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-tpac-route-'));
  const tpacDir = path.join(root, '.swt-planning', '.tpac');
  return { root, tpacDir };
}

describe('registerTpacRoute — GET /api/tpac/sse', () => {
  let fixture: Fixture | undefined;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    if (fixture !== undefined) {
      try {
        rmSync(fixture.root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    fixture = undefined;
  });

  it('emits an empty reports array when projectRoot is null', async () => {
    const app = new Hono();
    registerTpacRoute(app, null);
    const res = await app.request('/api/tpac/sse', {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'tpac.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as { reports: unknown[] };
      expect(data.reports).toEqual([]);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('emits an empty reports array when .tpac/ directory is missing', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    // Note: do NOT create .tpac/ dir.
    const app = new Hono();
    registerTpacRoute(app, fixture.root);
    const res = await app.request('/api/tpac/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'tpac.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as { reports: unknown[] };
      expect(data.reports).toEqual([]);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('returns reports sorted by recorded_at ascending', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    mkdirSync(fixture.tpacDir, { recursive: true });
    writeFileSync(
      path.join(fixture.tpacDir, 'm5.json'),
      JSON.stringify(makeReport({ milestone: 'M5', recorded_at: '2026-08-01T10:00:00.000Z' })),
    );
    writeFileSync(
      path.join(fixture.tpacDir, 'm2.json'),
      JSON.stringify(makeReport({ milestone: 'M2', recorded_at: '2026-05-12T10:00:00.000Z' })),
    );
    writeFileSync(
      path.join(fixture.tpacDir, 'm4.json'),
      JSON.stringify(
        makeReport({
          milestone: 'M4',
          recorded_at: '2026-07-01T10:00:00.000Z',
          tokens_per_criterion: 14_400, // -40% from M2 baseline
        }),
      ),
    );

    const app = new Hono();
    registerTpacRoute(app, fixture.root);
    const res = await app.request('/api/tpac/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'tpac.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as {
        reports: Array<{ milestone: string; tokens_per_criterion: number }>;
      };
      expect(data.reports).toHaveLength(3);
      expect(data.reports.map((r) => r.milestone)).toEqual(['M2', 'M4', 'M5']);
      expect(data.reports[1]?.tokens_per_criterion).toBe(14_400);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);

  it('skips corrupt JSON + schema-invalid files without halting valid ones', async () => {
    if (fixture === undefined) throw new Error('fixture not set');
    mkdirSync(fixture.tpacDir, { recursive: true });

    writeFileSync(path.join(fixture.tpacDir, 'corrupt.json'), '{not json');
    writeFileSync(
      path.join(fixture.tpacDir, 'invalid.json'),
      JSON.stringify({ schema_version: 1, milestone: 'M2' }), // missing required fields
    );
    writeFileSync(
      path.join(fixture.tpacDir, 'valid.json'),
      JSON.stringify(makeReport({ milestone: 'M2' })),
    );
    // Non-JSON file extension — silently ignored.
    writeFileSync(path.join(fixture.tpacDir, 'README.md'), '# notes');

    const app = new Hono();
    registerTpacRoute(app, fixture.root);
    const res = await app.request('/api/tpac/sse');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();
    try {
      const frame = await readUntilEvent(reader, (e) => e.event === 'tpac.snapshot', 1000);
      const data = JSON.parse(frame.data ?? '{}') as {
        reports: Array<{ milestone: string }>;
      };
      expect(data.reports).toHaveLength(1);
      expect(data.reports[0]?.milestone).toBe('M2');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }, 5_000);
});
