/**
 * `POST /api/init` route tests — synchronous server scaffold.
 *
 * Milestone 23 Phase 01 T03 — the alpha.10 Lead-subprocess assertions are
 * obsolete (the spawn block was removed). This file covers the new
 * contract:
 *
 *   1. Valid body returns 200 + the enriched JSON ({brownfield,
 *      git_initialized, stack}) — AC 19.
 *   2. Body validation is `.strict()` — unknown fields rejected with 400
 *      (AC 29).
 *   3. The body MUST NOT accept `provider_id` (regression lock for AC 30,
 *      Locked Decision #10).
 *   4. `init.start` + `init.complete` fire on the bus synchronously around
 *      the initProjectFn() call.
 *   5. `AlreadyInitializedError` surfaces as HTTP 409 (unchanged).
 *   6. The route boots with NO provider configured and still serves init
 *      successfully (AC 31 vendor-agnostic boot — the route never reads
 *      providerAuth state).
 *
 * Renamed from `init-route-subprocess.test.ts` — git preserves the blame
 * continuity since the file's premise is the same route, only the
 * architecture beneath changed.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AlreadyInitializedError } from '@swt-labs/core/scaffold/init-project.js';
import { SnapshotEventSchema } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventBus } from '../../src/server/event-bus.js';
import { registerInitRoute } from '../../src/server/routes/init.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────

function makeFakeBus(): { bus: EventBus; publishFn: ReturnType<typeof vi.fn> } {
  const publishFn = vi.fn();
  const bus: EventBus = {
    publish: publishFn,
    subscribe: () => () => {
      /* noop */
    },
    size: () => 0,
  };
  return { bus, publishFn };
}

/**
 * Default `initProject` seam — succeeds by returning a stub
 * InitProjectResult with the milestone-23 enriched shape.
 */
function makeFakeInitProject(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(({ cwd }: { cwd: string }) => ({
    root: cwd,
    files: [
      '.swt-planning/PROJECT.md',
      '.swt-planning/STATE.md',
      '.swt-planning/REQUIREMENTS.md',
      '.swt-planning/ROADMAP.md',
      '.swt-planning/config.json',
      '.swt-planning/phases',
    ],
    brownfield: false,
    gitInitialized: true,
    stack: [],
  }));
}

/**
 * Locate the single `.events/init-*.jsonl` file produced by the route on
 * this temp project. Used by JSONL-content assertions.
 */
function readInitEventsFile(projectRoot: string): string[] {
  const eventsDir = path.join(projectRoot, '.swt-planning', '.events');
  if (!existsSync(eventsDir)) return [];
  const files = readdirSync(eventsDir).filter((f) => f.startsWith('init-') && f.endsWith('.jsonl'));
  if (files.length === 0) return [];
  const filePath = path.join(eventsDir, files[0] as string);
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/init — synchronous server scaffold', () => {
  let tmpProjectRoot: string;

  beforeEach(() => {
    tmpProjectRoot = mkdtempSync(path.join(tmpdir(), 'init-route-test-'));
  });

  afterEach(() => {
    rmSync(tmpProjectRoot, { recursive: true, force: true });
  });

  it('AC 19 — returns 200 + enriched body (brownfield, git_initialized, stack) on valid input', async () => {
    const { bus } = makeFakeBus();
    const app = new Hono();
    const initProject = vi.fn().mockReturnValue({
      root: tmpProjectRoot,
      files: ['.swt-planning/PROJECT.md', '.swt-planning/config.json'],
      brownfield: true,
      gitInitialized: false,
      stack: ['typescript', 'react'],
    });

    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject,
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'foo',
        description: 'A foo project.',
        planning_tracking: 'commit',
        auto_push: 'after_phase',
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      initialized: boolean;
      root: string;
      files: string[];
      brownfield: boolean;
      git_initialized: boolean;
      stack: string[];
    };
    expect(body.initialized).toBe(true);
    expect(body.root).toBe(tmpProjectRoot);
    expect(body.brownfield).toBe(true);
    expect(body.git_initialized).toBe(false);
    expect(body.stack).toEqual(['typescript', 'react']);

    // initProject was called with planningTracking + autoPush passed
    // through from the body, plus the camelCase remap.
    expect(initProject).toHaveBeenCalledTimes(1);
    const callArgs = initProject.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['name']).toBe('foo');
    expect(callArgs?.['description']).toBe('A foo project.');
    expect(callArgs?.['planningTracking']).toBe('commit');
    expect(callArgs?.['autoPush']).toBe('after_phase');
    expect(callArgs?.['source']).toBe('dashboard');
  });

  it('AC 29 — rejects unknown fields (strict mode) with 400', async () => {
    const { bus } = makeFakeBus();
    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'foo',
        description: 'desc',
        foo_unknown_field: 'should-be-rejected',
      }),
    });
    expect(res.status).toBe(400);
    const errBody = (await res.json()) as { error: string };
    expect(errBody.error).toBe('invalid_body');
  });

  it('AC 30 — body MUST NOT accept provider_id (vendor-agnostic regression lock)', async () => {
    const { bus } = makeFakeBus();
    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'foo',
        description: 'desc',
        provider_id: 'anthropic',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('emits init.start + init.complete synchronously on the bus around the scaffold', async () => {
    const { bus, publishFn } = makeFakeBus();
    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo', description: 'desc' }),
    });
    expect(res.status).toBe(200);

    // bus.publish double-channel — init.start AND init.complete must have
    // landed on the bus by the time the HTTP response resolved.
    const startCall = publishFn.mock.calls.find(
      (call) => (call[0] as { type?: string })?.type === 'init.start',
    );
    expect(startCall).toBeDefined();
    expect((startCall?.[0] as { name?: string }).name).toBe('foo');
    expect((startCall?.[0] as { description?: string }).description).toBe('desc');

    const completeCall = publishFn.mock.calls.find(
      (call) => (call[0] as { type?: string })?.type === 'init.complete',
    );
    expect(completeCall).toBeDefined();
    const complete = completeCall?.[0] as {
      status?: string;
      brownfield?: boolean;
      git_initialized?: boolean;
      stack?: readonly string[];
    };
    expect(complete.status).toBe('success');
    expect(complete.brownfield).toBe(false);
    expect(complete.git_initialized).toBe(true);
    expect(complete.stack).toEqual([]);
  });

  it('JSONL channel carries init.start + init.complete (tailer-driven replay)', async () => {
    const { bus } = makeFakeBus();
    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    const lines = readInitEventsFile(tmpProjectRoot);
    expect(lines.length).toBe(2);

    const first = SnapshotEventSchema.safeParse(JSON.parse(lines[0] as string));
    expect(first.success).toBe(true);
    if (first.success) expect(first.data.type).toBe('init.start');

    const second = SnapshotEventSchema.safeParse(JSON.parse(lines[1] as string));
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data.type).toBe('init.complete');
      if (second.data.type === 'init.complete') {
        expect(second.data.status).toBe('success');
      }
    }
  });

  it('AlreadyInitializedError surfaces as HTTP 409 (unchanged)', async () => {
    const { bus } = makeFakeBus();
    const app = new Hono();
    const throwingInitProject = vi.fn().mockImplementation(() => {
      throw new AlreadyInitializedError(path.join(tmpProjectRoot, '.swt-planning'));
    });
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject: throwingInitProject,
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(409);

    // No JSONL file written because the scaffold threw before the
    // synchronous event-emission step ran.
    const eventsDir = path.join(tmpProjectRoot, '.swt-planning', '.events');
    expect(existsSync(eventsDir)).toBe(false);
  });

  it('generic initProject error surfaces as HTTP 500', async () => {
    const { bus } = makeFakeBus();
    const app = new Hono();
    const throwingInitProject = vi.fn().mockImplementation(() => {
      throw new Error('disk full');
    });
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject: throwingInitProject,
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe('init_failed');
    expect(body.detail).toBe('disk full');
  });

  it('AC 31 — boots + serves init successfully without any provider configured (vendor-agnostic)', async () => {
    // The route never reads from a providerAuth state surface — registering
    // it requires no provider seam at all. Boot it with the minimal options,
    // call /api/init, and assert success. This is the structural assertion
    // that the route is vendor-agnostic by construction.
    const { bus } = makeFakeBus();
    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo', description: 'desc' }),
    });
    expect(res.status).toBe(200);
  });

  it('does not throw when bus is omitted (graceful degradation)', async () => {
    const app = new Hono();
    // bus is intentionally omitted.
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    // init.start + init.complete still land in JSONL (the tailer-driven
    // path is bus-independent).
    const lines = readInitEventsFile(tmpProjectRoot);
    expect(lines.length).toBe(2);
  });

  it('omits description in the upstream call when absent; applies Zod defaults for planning_tracking + auto_push', async () => {
    const { bus } = makeFakeBus();
    const app = new Hono();
    const initProject = vi.fn().mockReturnValue({
      root: tmpProjectRoot,
      files: ['.swt-planning/PROJECT.md'],
      brownfield: false,
      gitInitialized: true,
      stack: [],
    });
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      initProject,
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    const callArgs = initProject.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['name']).toBe('foo');
    expect(callArgs?.['description']).toBeUndefined();
    // Defaults from the Zod schema are applied at parse time, so the
    // call still carries planningTracking + autoPush from .default().
    expect(callArgs?.['planningTracking']).toBe('manual');
    expect(callArgs?.['autoPush']).toBe('never');
  });
});
