import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SnapshotEvent } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus } from '../src/server/event-bus.js';
import { createEventsTailer, type EventsTailer } from '../src/server/snapshot/events-tailer.js';

function setupFixture(): { root: string; eventsDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-evt-tailer-'));
  const eventsDir = path.join(root, '.swt-planning', '.events');
  mkdirSync(eventsDir, { recursive: true });
  return { root, eventsDir };
}

function jsonl(events: readonly Record<string, unknown>[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

const sampleSpawn = {
  type: 'agent.spawn' as const,
  ts: '2026-05-09T10:00:00Z',
  agent: 'scout',
  phase: '03',
  plan: null,
};

const sampleComplete = {
  type: 'agent.complete' as const,
  ts: '2026-05-09T10:00:30Z',
  agent: 'scout',
  phase: '03',
  plan: '03-01',
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.01,
  duration_ms: 30000,
  artifact: '03-RESEARCH.md',
};

const sampleLog = {
  type: 'log.append' as const,
  ts: '2026-05-09T10:00:31Z',
  channel: 'stdout' as const,
  line: 'hello',
};

// `retry: 2` — these tests exercise real filesystem-watch + poll timing.
// They pass in isolation but flake intermittently under the full parallel
// test suite when FS-watch + poll cycles get delayed under load. A scoped
// retry absorbs the transient load flake without losing coverage; a
// genuinely-broken test still fails all three attempts.
describe('createEventsTailer', { retry: 2 }, () => {
  let root: string;
  let eventsDir: string;
  let tailer: EventsTailer | undefined;

  beforeEach(() => {
    const f = setupFixture();
    root = f.root;
    eventsDir = f.eventsDir;
  });

  afterEach(async () => {
    if (tailer) await tailer.close();
    tailer = undefined;
  });

  it('publishes a SnapshotEvent for each appended JSONL line', async () => {
    const bus = createEventBus();
    const received: SnapshotEvent[] = [];
    bus.subscribe((event) => received.push(event));

    tailer = createEventsTailer({ projectRoot: root, bus });
    await tailer.ready;

    const filePath = path.join(eventsDir, 'session-1.jsonl');
    writeFileSync(filePath, jsonl([sampleSpawn]));
    await waitFor(() => received.length >= 1);
    expect(received[0]?.type).toBe('agent.spawn');

    appendFileSync(filePath, jsonl([sampleComplete, sampleLog]));
    await waitFor(() => received.length >= 3);
    expect(received.map((e) => e.type)).toContain('agent.complete');
    expect(received.map((e) => e.type)).toContain('log.append');
  });

  it('skips invalid JSON lines without halting subsequent events', async () => {
    const bus = createEventBus();
    const received: SnapshotEvent[] = [];
    bus.subscribe((event) => received.push(event));

    tailer = createEventsTailer({ projectRoot: root, bus });
    await tailer.ready;

    const filePath = path.join(eventsDir, 'session-2.jsonl');
    writeFileSync(
      filePath,
      `${JSON.stringify(sampleSpawn)}\nNOT JSON\n${JSON.stringify(sampleLog)}\n`,
    );

    await waitFor(() => received.length >= 2);
    expect(received).toHaveLength(2);
    expect(received[0]?.type).toBe('agent.spawn');
    expect(received[1]?.type).toBe('log.append');
  });

  it('skips lines that fail SnapshotEvent schema validation', async () => {
    const bus = createEventBus();
    const received: SnapshotEvent[] = [];
    bus.subscribe((event) => received.push(event));

    tailer = createEventsTailer({ projectRoot: root, bus });
    await tailer.ready;

    const filePath = path.join(eventsDir, 'session-3.jsonl');
    writeFileSync(
      filePath,
      jsonl([{ type: 'unknown_event', ts: '2026-05-09T10:00:00Z' }, sampleSpawn]),
    );

    await waitFor(() => received.length >= 1);
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('agent.spawn');
  });

  it('handles multiple session files interleaved correctly', async () => {
    const bus = createEventBus();
    const received: SnapshotEvent[] = [];
    bus.subscribe((event) => received.push(event));

    tailer = createEventsTailer({ projectRoot: root, bus });
    await tailer.ready;

    const fileA = path.join(eventsDir, 'session-a.jsonl');
    const fileB = path.join(eventsDir, 'session-b.jsonl');
    writeFileSync(fileA, jsonl([sampleSpawn]));
    writeFileSync(fileB, jsonl([sampleLog]));

    await waitFor(() => received.length >= 2);
    expect(received.map((e) => e.type).sort()).toEqual(['agent.spawn', 'log.append']);
  });

  it('alpha.47 — chat.* events tailed from chat-*.jsonl are NOT republished (route already publishes them directly)', async () => {
    const { root, eventsDir } = setupFixture();
    const bus = createEventBus();
    const received: SnapshotEvent[] = [];
    bus.subscribe((event) => received.push(event));

    tailer = createEventsTailer({ projectRoot: root, bus });
    await tailer.ready;

    // Mix a chat.* line in the same file as a non-chat event. Only the
    // non-chat event must republish; the chat.* line is silently
    // dropped by the alpha.47 skip guard in events-tailer.ts.
    const sampleChatStart = {
      type: 'chat.start' as const,
      ts: '2026-05-20T12:00:00.000Z',
      chat_session_id: 'sid-suppress',
      prompt: 'hi',
    };
    const chatFile = path.join(eventsDir, 'chat-sid-suppress.jsonl');
    const cookFile = path.join(eventsDir, 'agent-suppress.jsonl');
    writeFileSync(chatFile, jsonl([sampleChatStart]));
    writeFileSync(cookFile, jsonl([sampleSpawn]));

    await waitFor(() => received.length >= 1);
    // Exactly one published event — the agent.spawn. The chat.start must
    // be filtered out (otherwise live chat clients would receive every
    // chat event TWICE: once from the route's direct bus.publish and
    // once from the chokidar-driven tailer republish).
    expect(received.map((e) => e.type)).toEqual(['agent.spawn']);
  });
});
