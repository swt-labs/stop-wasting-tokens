/**
 * Plan 01-01 T4 (milestone 08, Phase 01) — Pattern A regression coverage
 * for createUsageAggregator + createUsageRollupRoute.
 *
 * Mirrors `packages/dashboard/test/events-tailer.test.ts`:
 *   - `mkdtempSync` for a hermetic project root (E2E case)
 *   - `mkdirSync(eventsDir, { recursive: true })`
 *   - real `createEventBus()` (no mocks)
 *   - `appendFileSync` for the one end-to-end case that exercises the
 *     events-tailer → bus → aggregator path
 *   - `{ retry: 2 }` on the outer describe (FS-watch flake absorption
 *     for the E2E case; the synchronous bus.publish cases are
 *     deterministic and unaffected by retries)
 *   - `now: () => mockNow` seam so boundary cases at 6d / 7d / 8d /
 *     29d / 30d / 31d are deterministic
 *
 * Coverage map (9 cases per plan):
 *   1. Empty state
 *   2. Boundary inclusion at 6d, 7d (both IN window_7d)
 *   3. Boundary exclusion at 8d (OUT of window_7d, IN window_30d)
 *   4. Boundary at 29d / 30d (IN window_30d) + 31d (OUT, pruned)
 *   5. 31d prune (the 31d-and-older entry contributes nothing after
 *      a fresh in-window event is published)
 *   6. Multi-session sum
 *   7. state.changed publish carries the partial usage_rollup
 *   8. End-to-end via real events-tailer + JSONL appendFileSync
 *   9. agent.complete + other non-cook.agent_result events are ignored
 *
 * Plus a small route-layer smoke check that GET /api/usage-rollup
 * returns 200 with the correct shape (empty state and populated).
 */

import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UsageRollupSchema, type SnapshotEvent } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import { createEventsTailer, type EventsTailer } from '../src/server/snapshot/events-tailer.js';
import { createUsageRollupRoute } from '../src/server/routes/usage-rollup.js';
import { createUsageAggregator, type UsageAggregator } from '../src/server/usage-aggregator.js';

const FIXED_NOW = Date.parse('2026-05-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function mkResultEvent(
  daysAgo: number,
  cost: number,
  tokensIn: number,
  tokensOut: number,
  sessionId = 'sess-1',
  subId?: string,
): SnapshotEvent {
  return {
    type: 'cook.agent_result',
    ts: new Date(FIXED_NOW - daysAgo * DAY_MS).toISOString(),
    session_id: sessionId,
    sub_session_id: subId ?? `sub-${Math.random().toString(36).slice(2)}`,
    status: 'completed',
    usage: { input_tokens: tokensIn, output_tokens: tokensOut, cost_usd: cost },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// `retry: 2` mirrors events-tailer.test.ts line 64 — the E2E (case 8)
// exercises real chokidar + tail-file polling and can intermittently
// flake under full-suite parallel load. The synchronous bus.publish
// cases are deterministic; retries are harmless for them.
describe('createUsageAggregator', { retry: 2 }, () => {
  let bus: EventBus;
  let aggregator: UsageAggregator | undefined;
  const mockNow = (): number => FIXED_NOW;

  beforeEach(() => {
    bus = createEventBus();
  });

  afterEach(() => {
    if (aggregator) aggregator.close();
    aggregator = undefined;
  });

  it('empty state returns { window_7d: null, window_30d: null, generated_at }', () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });
    const result = aggregator.compute();
    expect(result.window_7d).toBeNull();
    expect(result.window_30d).toBeNull();
    expect(result.generated_at).toBe(new Date(FIXED_NOW).toISOString());
    // Shape parses cleanly through the shared Zod schema.
    expect(() => UsageRollupSchema.parse(result)).not.toThrow();
  });

  it('includes events at 6d and exactly 7d in window_7d (inclusive boundary)', () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });
    bus.publish(mkResultEvent(6, 1, 100, 50));
    bus.publish(mkResultEvent(7, 2, 200, 100));

    const result = aggregator.compute();
    expect(result.window_7d).not.toBeNull();
    expect(result.window_7d!.cost_usd).toBeCloseTo(3, 10);
    expect(result.window_7d!.tokens_in).toBe(300);
    expect(result.window_7d!.tokens_out).toBe(150);
    // Both also fall inside window_30d.
    expect(result.window_30d!.cost_usd).toBeCloseTo(3, 10);
  });

  it('excludes events at 8d from window_7d but keeps them in window_30d', () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });
    bus.publish(mkResultEvent(6, 1, 10, 5));
    bus.publish(mkResultEvent(8, 5, 50, 25));

    const result = aggregator.compute();
    expect(result.window_7d!.cost_usd).toBeCloseTo(1, 10);
    expect(result.window_30d!.cost_usd).toBeCloseTo(6, 10);
  });

  it('boundary at 29d / 30d (IN window_30d) and 31d (OUT, pruned)', () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });
    bus.publish(mkResultEvent(29, 1, 1, 1));
    bus.publish(mkResultEvent(30, 2, 2, 2));
    // 31d is past the inclusive boundary AND past the prune threshold (PRUNE_MS = 31d).
    // The publish path still appends, then immediately prunes (strict > so exactly-31d
    // is dropped); compute then sees only the 29d and 30d records.
    bus.publish(mkResultEvent(31, 4, 4, 4));

    const result = aggregator.compute();
    // Records exist, so window_7d is a zero-sum (not null).
    expect(result.window_7d).not.toBeNull();
    expect(result.window_7d!.cost_usd).toBe(0);
    expect(result.window_7d!.tokens_in).toBe(0);
    expect(result.window_7d!.tokens_out).toBe(0);

    expect(result.window_30d!.cost_usd).toBeCloseTo(3, 10);
    expect(result.window_30d!.tokens_in).toBe(3);
    expect(result.window_30d!.tokens_out).toBe(3);
  });

  it('prunes records older than 31d on each new event (no contribution from 35d / 60d)', () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });
    // 35d and 60d events are pruned on the next publish.
    bus.publish(mkResultEvent(35, 99, 999, 999));
    bus.publish(mkResultEvent(60, 7, 70, 70));
    bus.publish(mkResultEvent(5, 1, 10, 5));

    const result = aggregator.compute();
    // Only the 5d entry survives; window_7d and window_30d both equal its values.
    expect(result.window_7d!.cost_usd).toBeCloseTo(1, 10);
    expect(result.window_7d!.tokens_in).toBe(10);
    expect(result.window_7d!.tokens_out).toBe(5);
    expect(result.window_30d!.cost_usd).toBeCloseTo(1, 10);
    expect(result.window_30d!.tokens_in).toBe(10);
    expect(result.window_30d!.tokens_out).toBe(5);
  });

  it('sums across different session_ids (no per-session segmentation)', () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });
    bus.publish(mkResultEvent(3, 1, 100, 50, 'sess-a'));
    bus.publish(mkResultEvent(3, 2, 200, 100, 'sess-b'));

    const result = aggregator.compute();
    expect(result.window_7d!.cost_usd).toBeCloseTo(3, 10);
    expect(result.window_7d!.tokens_in).toBe(300);
    expect(result.window_7d!.tokens_out).toBe(150);
  });

  it('publishes a state.changed partial with usage_rollup after each cook.agent_result', async () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });

    const received: SnapshotEvent[] = [];
    bus.subscribe((e) => {
      if (e.type === 'state.changed') received.push(e);
    });

    bus.publish(mkResultEvent(1, 1, 100, 50));

    await waitFor(() => received.length >= 1);
    const evt = received[0];
    expect(evt?.type).toBe('state.changed');
    if (evt?.type !== 'state.changed') throw new Error('unreachable');
    expect(evt.changed).toEqual(['cost']);
    const partial = evt.snapshot.usage_rollup;
    expect(partial).toBeDefined();
    expect(partial!.window_7d).not.toBeNull();
    expect(partial!.window_7d!.cost_usd).toBeCloseTo(1, 10);
    expect(typeof partial!.generated_at).toBe('string');
    expect(() => new Date(partial!.generated_at).toISOString()).not.toThrow();
  });

  it('ignores agent.complete and other non-cook.agent_result events', () => {
    aggregator = createUsageAggregator({ bus, now: mockNow });
    bus.publish({
      type: 'agent.complete',
      ts: new Date(FIXED_NOW - DAY_MS).toISOString(),
      agent: 'scout',
      phase: '03',
      plan: '03-01',
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 99,
      duration_ms: 30000,
      artifact: '03-RESEARCH.md',
    });
    bus.publish({
      type: 'cook.completion',
      ts: new Date(FIXED_NOW - DAY_MS).toISOString(),
      session_id: 'sess-x',
      status: 'success',
      total_cost_usd: 42,
    });
    bus.publish({
      type: 'cook.budget_exceeded',
      ts: new Date(FIXED_NOW - DAY_MS).toISOString(),
      session_id: 'sess-x',
      reason: 'paused_on_entry',
      spent_usd: 5,
      ceiling_usd: 10,
      threshold: 0.5,
    });

    const result = aggregator.compute();
    expect(result.window_7d).toBeNull();
    expect(result.window_30d).toBeNull();
  });

  describe('end-to-end via real events-tailer + JSONL append', () => {
    let root: string;
    let eventsDir: string;
    let tailer: EventsTailer | undefined;

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'usage-aggregator-'));
      eventsDir = path.join(root, '.swt-planning', '.events');
      mkdirSync(eventsDir, { recursive: true });
    });

    afterEach(async () => {
      if (tailer) await tailer.close();
      tailer = undefined;
    });

    it('aggregator picks up cook.agent_result rows appended to a JSONL file', async () => {
      // Use real wall-clock so the file event's ts is within the rolling window.
      const wallNow = Date.now();
      const realNow = (): number => wallNow;
      aggregator = createUsageAggregator({ bus, now: realNow });

      tailer = createEventsTailer({ projectRoot: root, bus });
      await tailer.ready;

      const filePath = path.join(eventsDir, 'cook-sess-e2e-stamp.jsonl');
      const row: SnapshotEvent = {
        type: 'cook.agent_result',
        ts: new Date(wallNow - 2 * DAY_MS).toISOString(),
        session_id: 'sess-e2e',
        sub_session_id: 'sub-e2e-1',
        status: 'completed',
        usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.5 },
      };
      appendFileSync(filePath, JSON.stringify(row) + '\n');

      await waitFor(() => {
        const r = aggregator!.compute();
        return r.window_7d !== null && Math.abs(r.window_7d.cost_usd - 0.5) < 1e-9;
      }, 3000);

      const result = aggregator.compute();
      expect(result.window_7d!.cost_usd).toBeCloseTo(0.5, 10);
      expect(result.window_7d!.tokens_in).toBe(10);
      expect(result.window_7d!.tokens_out).toBe(5);
    });
  });
});

describe('createUsageRollupRoute', () => {
  it('GET /api/usage-rollup returns 200 with empty-state payload when no events seen', async () => {
    const bus = createEventBus();
    const aggregator = createUsageAggregator({ bus, now: () => FIXED_NOW });
    try {
      const app = createUsageRollupRoute({ aggregator });
      const res = await app.fetch(new Request('http://localhost/api/usage-rollup'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown;
      const parsed = UsageRollupSchema.parse(body);
      expect(parsed.window_7d).toBeNull();
      expect(parsed.window_30d).toBeNull();
      expect(typeof parsed.generated_at).toBe('string');
    } finally {
      aggregator.close();
    }
  });

  it('GET /api/usage-rollup returns 200 with summed windows after events are published', async () => {
    const bus = createEventBus();
    const aggregator = createUsageAggregator({ bus, now: () => FIXED_NOW });
    try {
      bus.publish(mkResultEvent(1, 1.25, 100, 50));
      bus.publish(mkResultEvent(2, 0.75, 50, 25));

      const app = createUsageRollupRoute({ aggregator });
      const res = await app.fetch(new Request('http://localhost/api/usage-rollup'));
      expect(res.status).toBe(200);

      const parsed = UsageRollupSchema.parse(await res.json());
      expect(parsed.window_7d).not.toBeNull();
      expect(parsed.window_7d!.cost_usd).toBeCloseTo(2.0, 10);
      expect(parsed.window_7d!.tokens_in).toBe(150);
      expect(parsed.window_7d!.tokens_out).toBe(75);
    } finally {
      aggregator.close();
    }
  });
});
