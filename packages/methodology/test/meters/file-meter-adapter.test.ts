/**
 * Plan 06-02 T1 — file-meter-adapter unit tests.
 *
 * Coverage:
 *   1. Delta math — overwrite a metrics file → subscribers see delta, not total.
 *   2. Multi-file independence — two session files emit per-file deltas.
 *   3. Parse-error tolerance — malformed JSON does NOT throw; warn callback fires.
 *   4. Initial snapshot — pre-existing file establishes baseline; next write emits delta.
 *   5. Negative-delta guard — file decreasing in cost does NOT emit a negative event.
 */

import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MeterUpdate } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createFileMeterAdapter,
  type FileMeterAdapter,
} from '../../src/meters/file-meter-adapter.js';
import type { SessionMetrics } from '../../src/meters/token-meter.js';

let dir: string;
let adapter: FileMeterAdapter | null = null;

function writeSession(sessionId: string, data: Partial<SessionMetrics>): void {
  const filePath = join(dir, `session-${sessionId}.json`);
  const full: SessionMetrics = {
    session_id: sessionId,
    agent_results: data.agent_results ?? 0,
    tokens: data.tokens ?? { in: 0, out: 0, cache_creation: 0, cache_read: 0 },
    cost_usd: data.cost_usd ?? 0,
    cache_hit_ratio: data.cache_hit_ratio ?? 0,
    last_updated: data.last_updated ?? new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(full));
}

async function waitFor<T>(
  pred: () => T | undefined | null | false,
  timeoutMs = 5000,
  pollMs = 50,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`waitFor: predicate did not become truthy within ${timeoutMs}ms`);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-file-meter-'));
});

afterEach(async () => {
  if (adapter !== null) {
    await adapter.close();
    adapter = null;
  }
  await rm(dir, { recursive: true, force: true });
});

describe('createFileMeterAdapter — delta math', () => {
  it('emits cost_usd DELTA (not absolute) when a session file is overwritten', async () => {
    writeSession('a', {
      cost_usd: 1.0,
      tokens: { in: 100, out: 50, cache_creation: 0, cache_read: 0 },
    });

    adapter = createFileMeterAdapter({ metricsDir: dir, clock: () => 'T1' });
    const events: MeterUpdate[] = [];
    adapter.subscribe((e) => events.push(e));

    // Allow chokidar to register the pre-existing file as baseline.
    await new Promise((r) => setTimeout(r, 250));

    writeSession('a', {
      cost_usd: 1.5,
      tokens: { in: 150, out: 75, cache_creation: 0, cache_read: 0 },
    });

    const evt = await waitFor(() => (events.length > 0 ? events[0] : undefined));
    expect(evt.type).toBe('METER_UPDATED');
    expect(evt.record.cost_usd).toBeCloseTo(0.5, 6);
    expect(evt.record.input).toBe(50);
    expect(evt.record.output).toBe(25);
    expect(evt.record.timestamp).toBe('T1');
  });
});

describe('createFileMeterAdapter — multi-file independence', () => {
  it('emits per-file deltas; updating one file does not double-count the other', async () => {
    writeSession('a', { cost_usd: 1.0 });
    writeSession('b', { cost_usd: 2.0 });

    adapter = createFileMeterAdapter({ metricsDir: dir });
    const events: MeterUpdate[] = [];
    adapter.subscribe((e) => events.push(e));

    await new Promise((r) => setTimeout(r, 250));

    // Only update session-a.
    writeSession('a', { cost_usd: 1.7 });

    await waitFor(() => events.length >= 1);
    expect(events.length).toBe(1);
    expect(events[0]?.record.cost_usd).toBeCloseTo(0.7, 6);
    expect(events[0]?.record.task_id).toBe('a');
  });
});

describe('createFileMeterAdapter — parse-error tolerance', () => {
  it('does NOT throw on malformed JSON; warn sink fires; recovers on next valid write', async () => {
    const warnings: string[] = [];
    adapter = createFileMeterAdapter({
      metricsDir: dir,
      onWarn: (m) => warnings.push(m),
    });
    const events: MeterUpdate[] = [];
    adapter.subscribe((e) => events.push(e));

    const filePath = join(dir, 'session-z.json');
    // First write a valid baseline so the adapter has something to delta from.
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        session_id: 'z',
        cost_usd: 0.5,
        tokens: { in: 0, out: 0, cache_creation: 0, cache_read: 0 },
        agent_results: 0,
        cache_hit_ratio: 0,
        last_updated: 't',
      }),
    );
    await new Promise((r) => setTimeout(r, 250));

    // Now write a garbage partial — the adapter must NOT throw or emit.
    fs.writeFileSync(filePath, '{"session_id": "z", "cost_usd"');
    await new Promise((r) => setTimeout(r, 250));

    expect(events.length).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join('\n')).toMatch(/parse error/);

    // Subsequent valid write fires correctly.
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        session_id: 'z',
        cost_usd: 0.9,
        tokens: { in: 0, out: 0, cache_creation: 0, cache_read: 0 },
        agent_results: 0,
        cache_hit_ratio: 0,
        last_updated: 't2',
      }),
    );
    await waitFor(() => events.length >= 1);
    expect(events[0]?.record.cost_usd).toBeCloseTo(0.4, 6);
  });
});

describe('createFileMeterAdapter — initial snapshot baseline', () => {
  it('treats a pre-existing file as baseline; next write emits ONLY the delta', async () => {
    writeSession('seed', { cost_usd: 2.0 });

    adapter = createFileMeterAdapter({ metricsDir: dir });
    const events: MeterUpdate[] = [];
    adapter.subscribe((e) => events.push(e));

    // chokidar's `add` fires for pre-existing files. No emission should occur
    // on that event (baseline-only).
    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBe(0);

    writeSession('seed', { cost_usd: 2.5 });
    await waitFor(() => events.length >= 1);

    // Delta is 0.5, NOT 2.5.
    expect(events[0]?.record.cost_usd).toBeCloseTo(0.5, 6);
  });
});

describe('createFileMeterAdapter — negative-delta guard', () => {
  it('does NOT emit when cost_usd decreases (file rewrite / clock skew)', async () => {
    writeSession('n', { cost_usd: 5.0 });
    adapter = createFileMeterAdapter({ metricsDir: dir });
    const events: MeterUpdate[] = [];
    adapter.subscribe((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 250));

    // Rewrite with LOWER cost.
    writeSession('n', { cost_usd: 3.0 });
    await new Promise((r) => setTimeout(r, 300));

    expect(events.length).toBe(0);
  });
});
