import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCliEventBus, type CliEvent } from '../src/lifecycle/event-bus.js';

function setupProject(): string {
  return mkdtempSync(path.join(tmpdir(), 'swt-cli-events-'));
}

function readLines(filePath: string): CliEvent[] {
  const text = readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CliEvent);
}

describe('createCliEventBus', () => {
  it('writes a JSONL file at .swt-planning/.events/<sessionId>.jsonl on close', async () => {
    const root = setupProject();
    const bus = createCliEventBus({ projectRoot: root, sessionId: 'session-1' });
    bus.emit({
      type: 'agent.spawn',
      ts: '2026-05-09T10:00:00Z',
      agent: 'scout',
      phase: '03',
      plan: '03-01',
    });
    await bus.close();

    expect(bus.path.endsWith('.swt-planning/.events/session-1.jsonl')).toBe(true);
    expect(existsSync(bus.path)).toBe(true);
    const lines = readLines(bus.path);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.type).toBe('agent.spawn');
  });

  it('emits all 5 event types in correct shape', async () => {
    const root = setupProject();
    const bus = createCliEventBus({ projectRoot: root, sessionId: 'session-2', bufferMs: 0 });
    const events: CliEvent[] = [
      {
        type: 'agent.spawn',
        ts: '2026-05-09T10:00:00Z',
        agent: 'scout',
        phase: '03',
        plan: null,
      },
      {
        type: 'agent.complete',
        ts: '2026-05-09T10:00:30Z',
        agent: 'scout',
        phase: '03',
        plan: '03-01',
        tokens_in: 1200,
        tokens_out: 800,
        cost_usd: 0.024,
        duration_ms: 30000,
        artifact: '03-RESEARCH.md',
      },
      {
        type: 'phase.transition',
        ts: '2026-05-09T10:00:31Z',
        phase: '03',
        from: 'needs_plan_and_execute',
        to: 'needs_execute',
      },
      {
        type: 'qa_gate',
        ts: '2026-05-09T10:01:00Z',
        phase: '03',
        routing: 'PROCEED_TO_UAT',
        passed: 5,
        total: 5,
      },
      {
        type: 'log.append',
        ts: '2026-05-09T10:01:01Z',
        channel: 'stdout',
        line: 'hello world',
      },
    ];
    for (const event of events) bus.emit(event);
    await bus.close();

    const lines = readLines(bus.path);
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => l.type)).toEqual([
      'agent.spawn',
      'agent.complete',
      'phase.transition',
      'qa_gate',
      'log.append',
    ]);
  });

  it('buffers writes within the 50ms flush window', async () => {
    const root = setupProject();
    const bus = createCliEventBus({ projectRoot: root, sessionId: 'session-3', bufferMs: 50 });
    bus.emit({
      type: 'log.append',
      ts: '2026-05-09T10:00:00Z',
      channel: 'stdout',
      line: 'a',
    });
    bus.emit({
      type: 'log.append',
      ts: '2026-05-09T10:00:00Z',
      channel: 'stdout',
      line: 'b',
    });
    bus.emit({
      type: 'log.append',
      ts: '2026-05-09T10:00:00Z',
      channel: 'stdout',
      line: 'c',
    });
    await bus.close();
    const lines = readLines(bus.path);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => (l.type === 'log.append' ? l.line : null))).toEqual(['a', 'b', 'c']);
  });

  it('flushes pending events on close even if before flush window', async () => {
    const root = setupProject();
    const bus = createCliEventBus({ projectRoot: root, sessionId: 'session-4', bufferMs: 60_000 });
    bus.emit({
      type: 'log.append',
      ts: '2026-05-09T10:00:00Z',
      channel: 'stdout',
      line: 'pending',
    });
    await bus.close(); // close should flush even though 60s window hasn't elapsed
    const lines = readLines(bus.path);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'log.append', line: 'pending' });
  });

  it('close is idempotent (second call no-ops)', async () => {
    const root = setupProject();
    const bus = createCliEventBus({ projectRoot: root, sessionId: 'session-5' });
    bus.emit({
      type: 'agent.spawn',
      ts: '2026-05-09T10:00:00Z',
      agent: 'scout',
      phase: '03',
      plan: null,
    });
    await bus.close();
    await bus.close(); // should not throw
    await bus.close();
    expect(readLines(bus.path)).toHaveLength(1);
  });

  it('drops emit calls after close (does not throw, does not append)', async () => {
    const root = setupProject();
    const bus = createCliEventBus({ projectRoot: root, sessionId: 'session-6', bufferMs: 0 });
    bus.emit({
      type: 'agent.spawn',
      ts: '2026-05-09T10:00:00Z',
      agent: 'scout',
      phase: '03',
      plan: null,
    });
    await bus.close();
    bus.emit({
      type: 'agent.spawn',
      ts: '2026-05-09T10:00:01Z',
      agent: 'lead',
      phase: '03',
      plan: null,
    });
    expect(readLines(bus.path)).toHaveLength(1);
  });
});
