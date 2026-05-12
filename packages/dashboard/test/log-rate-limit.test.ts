// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SnapshotEvent } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus } from '../src/server/event-bus.ts';
import { createEventsTailer } from '../src/server/snapshot/events-tailer.ts';

const FLUSH_TIMEOUT_MS = 1500;

function logEvent(seq: number, ts: string): string {
  return JSON.stringify({
    type: 'log.append',
    ts,
    channel: 'stdout',
    line: `line ${seq}`,
  });
}

function waitForCount(
  bus: ReturnType<typeof createEventBus>,
  target: number,
): Promise<SnapshotEvent[]> {
  return new Promise((resolveAll, reject) => {
    const seen: SnapshotEvent[] = [];
    const timer = setTimeout(() => {
      unsub();
      resolveAll(seen);
    }, FLUSH_TIMEOUT_MS);
    const unsub = bus.subscribe((evt) => {
      seen.push(evt);
      if (seen.length >= target) {
        clearTimeout(timer);
        unsub();
        resolveAll(seen);
      }
    });
    void reject; // unused
  });
}

let projectRoot: string;
let eventsDir: string;

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-rate-limit-'));
  eventsDir = path.join(projectRoot, '.swt-planning', '.events');
  mkdirSync(eventsDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe.skip('log.append rate limit (events-tailer)', () => {
  it('passes through log lines under the cap', async () => {
    const bus = createEventBus();
    const tailer = createEventsTailer({ projectRoot, bus, logRateLimitPerSec: 100 });

    const ts = new Date().toISOString();
    const file = path.join(eventsDir, 'session-A.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) => logEvent(i, ts)).join('\n') + '\n';

    const collected = waitForCount(bus, 5);
    appendFileSync(file, lines);
    const events = await collected;

    await tailer.close();
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.every((e) => e.type === 'log.append')).toBe(true);
  });

  it('drops over-cap lines and emits a synthetic notice on flush', async () => {
    const bus = createEventBus();
    let nowMs = 0;
    const tailer = createEventsTailer({
      projectRoot,
      bus,
      logRateLimitPerSec: 2,
      now: () => nowMs,
    });

    const file = path.join(eventsDir, 'session-B.jsonl');
    // 5 log lines arrive within the same window (nowMs unchanged) → 2 pass, 3 dropped.
    const ts = new Date().toISOString();
    const lines = Array.from({ length: 5 }, (_, i) => logEvent(i, ts)).join('\n') + '\n';

    const collected = waitForCount(bus, 2);
    appendFileSync(file, lines);
    const passed = await collected;

    expect(passed.length).toBe(2);

    // Advance the clock past the window and write one more — the rate-window
    // refill triggers the synthetic "N dropped" notice through the bus before
    // the new line is published.
    const dropNotice = waitForCount(bus, 1);
    nowMs += 1500;
    const ts2 = new Date().toISOString();
    appendFileSync(file, logEvent(99, ts2) + '\n');
    const more = await dropNotice;

    await tailer.close();

    const dropMessage = more.find(
      (e) => e.type === 'log.append' && /dropped due to rate limit/i.test(e.line),
    );
    expect(dropMessage).toBeDefined();
  });
});
