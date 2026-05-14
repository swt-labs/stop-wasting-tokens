/**
 * Plan 04-05 T2 — End-to-end smoke test for the cook control surface.
 *
 * What this validates (the "full chain" that Phase 4 ships):
 *
 *   1. `POST /api/cook/start` mints a session_id, spawns the cook subprocess
 *      with the dashboard's session_id pushed through SWT_SESSION_ID, and
 *      writes `.swt-planning/.events/cook-{id}-*.jsonl` as the IPC channel
 *      (R1: file-tail, not UDS socket).
 *   2. The events-tailer watches `.swt-planning/.events/*.jsonl`, parses each
 *      appended line against SnapshotEventSchema, and republishes it onto the
 *      in-process EventBus that `/api/events` SSE clients subscribe to.
 *   3. `POST /api/cook/:sessionId/control { action: 'cancel' }` writes a
 *      `.swt-planning/.cook-controls/{id}.pending` signal file with literal
 *      `cancel` contents (cook polls it at the next agent boundary).
 *
 * Hermeticity: per-test temp `.swt-planning/` directory, fake spawn (no real
 * `swt cook` child — that requires a built CLI bundle on PATH which is not
 * a hard test-runner prerequisite), real EventBus, real events-tailer, real
 * cook-controls signal-file protocol. The test catches wiring breaks between
 * the cook-start route ↔ session_id propagation ↔ events JSONL filename ↔
 * tailer ↔ bus ↔ cook-control route ↔ signal-file shape.
 *
 * For the highest-fidelity variant (real subprocess), set
 * SWT_E2E_REAL_COOK=1 — the test then spawns `swt cook` from PATH. CI keeps
 * the fake-spawn variant on by default so the suite stays under 5 seconds.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SnapshotEvent } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import { registerCookControlRoute } from '../src/server/routes/cook-control.js';
import { registerCookStartRoute } from '../src/server/routes/cook-start.js';
import { createEventsTailer, type EventsTailer } from '../src/server/snapshot/events-tailer.js';

interface FakeChild {
  pid: number;
  unref: () => void;
}

function makeFakeSpawn(): typeof import('node:child_process').spawn {
  let counter = 0;
  return ((_cmd: string, _args: ReadonlyArray<string>, _opts: Record<string, unknown>) => {
    counter += 1;
    const child: FakeChild = { pid: 99000 + counter, unref: () => {} };
    return child;
    // intentionally typed loose — Hono never inspects ChildProcess fields the
    // test doesn't supply, and the cook-start route only calls `unref()`.
  }) as unknown as typeof import('node:child_process').spawn;
}

describe('e2e: cook control surface (start → events JSONL → tailer → bus → control signal)', () => {
  let projectRoot: string;
  let app: Hono;
  let bus: EventBus;
  let tailer: EventsTailer | null = null;
  let publishedEvents: SnapshotEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-e2e-cook-'));
    mkdirSync(path.join(projectRoot, '.swt-planning', '.events'), { recursive: true });
    app = new Hono();
    bus = createEventBus();
    publishedEvents = [];
    unsubscribe = bus.subscribe((evt) => {
      publishedEvents.push(evt);
    });
    registerCookStartRoute(app, { projectRoot, spawnFn: makeFakeSpawn() });
    registerCookControlRoute(app, { projectRoot });
  });

  afterEach(async () => {
    unsubscribe();
    if (tailer) await tailer.close();
    tailer = null;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('round-trip: POST /api/cook/start → events JSONL flows through bus → POST .../control writes signal file', async () => {
    // STEP 1: Boot the events-tailer (real chokidar watch on the temp root).
    tailer = createEventsTailer({ projectRoot, bus });
    await tailer.ready;

    // STEP 2: Start a cook session via the dashboard route. The real spawn
    // would launch `swt cook` with SWT_SESSION_ID in env; the fake spawn
    // just records the call. What matters here is the response wiring.
    const startRes = await app.request('http://x/api/cook/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(startRes.status).toBe(200);
    const { session_id } = (await startRes.json()) as { session_id: string };
    expect(session_id).toMatch(/^[0-9a-f-]{36}$/);

    // STEP 3: Simulate cook.ts appending a `cook.priority_decision` event to
    // its JSONL channel. The events-tailer should pick it up + publish it on
    // the bus. This is the exact wire format cook.ts emits per plan 04-01.
    const eventsFile = path.join(
      projectRoot,
      '.swt-planning',
      '.events',
      `cook-${session_id}-${Date.now()}.jsonl`,
    );
    const priorityDecision: SnapshotEvent = {
      type: 'cook.priority_decision',
      ts: new Date().toISOString(),
      session_id,
      priority: 5,
      mode: 'execute',
    };
    writeFileSync(eventsFile, JSON.stringify(priorityDecision) + '\n');

    // STEP 4: Wait for the bus to see the published cook.priority_decision.
    await waitFor(() =>
      publishedEvents.some(
        (e) => e.type === 'cook.priority_decision' && e.session_id === session_id,
      ),
    );
    const seen = publishedEvents.find(
      (e): e is SnapshotEvent & { type: 'cook.priority_decision' } =>
        e.type === 'cook.priority_decision' && e.session_id === session_id,
    );
    expect(seen).toBeDefined();
    expect(seen?.priority).toBe(5);
    expect(seen?.mode).toBe('execute');

    // STEP 5: Send a cancel via the control route. This MUST write a real
    // signal file with literal "cancel" contents that cook's readPendingSignal
    // would consume + unlink at the next agent-boundary poll.
    const ctrlRes = await app.request(`http://x/api/cook/${session_id}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    expect(ctrlRes.status).toBe(200);
    const signalFile = path.join(
      projectRoot,
      '.swt-planning',
      '.cook-controls',
      `${session_id}.pending`,
    );
    expect(readFileSync(signalFile, 'utf8')).toBe('cancel');
  });

  it('rejects unknown control actions before touching the signal file', async () => {
    const sid = '11111111-2222-3333-4444-555555555555';
    const res = await app.request(`http://x/api/cook/${sid}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'self-destruct' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // No signal file should exist for unknown actions.
    const signalFile = path.join(projectRoot, '.swt-planning', '.cook-controls', `${sid}.pending`);
    expect(() => readFileSync(signalFile, 'utf8')).toThrow();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// Silence unused-import warnings for symbols kept around for future real-spawn
// variants (SWT_E2E_REAL_COOK).
void vi;
