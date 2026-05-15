/**
 * Plan 02-01 T4 — Pattern A regression test for the dashboard's
 * `POST /api/init` route. Mirrors `packages/dashboard/test/cook-start.test.ts`
 * exactly for scaffolding (real Hono app + FakeChild/FakeStderr + fake
 * EventBus). The route must:
 *
 *   1. Spawn `swt init <name>` after initProject() succeeds, with the
 *      `--description` flag omitted entirely when description is absent.
 *   2. Append an `init.start` JSONL row to
 *      .swt-planning/.events/init-<sessionId>-<ts>.jsonl AND publish
 *      `init.start` directly on the EventBus (double-channel).
 *   3. Fire init.complete (code=0) or init.error (non-zero with code
 *      INIT_SPAWN_FAILED for fast exits) via child.once('exit', ...).
 *   4. Return InitResponse-shaped JSON synchronously — the HTTP response
 *      must NOT block on subprocess exit.
 *   5. Gracefully degrade when bus is omitted (no throw, response still
 *      returns 200, no bus interaction).
 *   6. Skip the spawn entirely when initProject throws — no
 *      .events/ file written; no `init.start` event emitted.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AlreadyInitializedError } from '@swt-labs/core';
import { SnapshotEventSchema } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventBus } from '../src/server/event-bus.js';
import { registerInitRoute } from '../src/server/routes/init.js';

// ─── Fake subprocess scaffolding (copied from cook-start.test.ts) ───────

interface FakeStderr {
  on: (ev: string, cb: (chunk: Buffer | string) => void) => void;
  unref: () => void;
  dataCallbacks: Array<(chunk: Buffer | string) => void>;
}

interface FakeChild {
  pid: number;
  unref: ReturnType<typeof vi.fn>;
  stderr: FakeStderr;
  once: (ev: string, cb: (code: number | null) => void) => void;
  exitCallbacks: Array<(code: number | null) => void>;
}

interface RecordedSpawn {
  command: string;
  args: ReadonlyArray<string>;
  env: NodeJS.ProcessEnv | undefined;
  detached: boolean | undefined;
  stdio: unknown;
  cwd: string | undefined;
}

function makeFakeStderr(): FakeStderr {
  const dataCallbacks: Array<(chunk: Buffer | string) => void> = [];
  return {
    on(ev, cb) {
      if (ev === 'data') dataCallbacks.push(cb);
    },
    unref() {
      /* no-op */
    },
    dataCallbacks,
  };
}

function makeFakeSpawn(recorded: RecordedSpawn[]): {
  spawnFn: (
    command: string,
    args: ReadonlyArray<string>,
    opts: Record<string, unknown>,
  ) => FakeChild;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  return {
    spawnFn: (command, args, opts) => {
      recorded.push({
        command,
        args: [...args],
        env: opts['env'] as NodeJS.ProcessEnv | undefined,
        detached: opts['detached'] as boolean | undefined,
        stdio: opts['stdio'],
        cwd: opts['cwd'] as string | undefined,
      });
      const exitCallbacks: Array<(code: number | null) => void> = [];
      const child: FakeChild = {
        pid: 88000 + children.length,
        unref: vi.fn(),
        stderr: makeFakeStderr(),
        once(ev, cb) {
          if (ev === 'exit') exitCallbacks.push(cb);
        },
        exitCallbacks,
      };
      children.push(child);
      return child;
    },
    children,
  };
}

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
 * InitProjectResult. Tests that need failure modes override per-test.
 */
function makeFakeInitProject(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(({ cwd }: { cwd: string }) => ({
    root: cwd,
    files: ['.swt-planning/PROJECT.md', '.swt-planning/STATE.md'],
  }));
}

/**
 * Locate the single `.events/init-*.jsonl` file produced by the route on
 * this temp project. Used by JSONL-content assertions.
 */
function readInitEventsFile(projectRoot: string): string[] {
  const eventsDir = path.join(projectRoot, '.swt-planning', '.events');
  if (!existsSync(eventsDir)) return [];
  const files = readdirSync(eventsDir).filter(
    (f) => f.startsWith('init-') && f.endsWith('.jsonl'),
  );
  if (files.length === 0) return [];
  const filePath = path.join(eventsDir, files[0] as string);
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line);
}

// ─── Test bodies ─────────────────────────────────────────────────────────

describe('POST /api/init subprocess wiring', () => {
  let tmpProjectRoot: string;

  beforeEach(() => {
    tmpProjectRoot = mkdtempSync(path.join(tmpdir(), 'init-route-test-'));
  });

  afterEach(() => {
    rmSync(tmpProjectRoot, { recursive: true, force: true });
  });

  it('spawns swt init with name positional and no --description when description is absent', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);
    const { bus } = makeFakeBus();

    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);
    expect(recorded).toHaveLength(1);

    // Argv tail: ...prefixArgs, 'init', 'foo' — no --description.
    const args = recorded[0]?.args ?? [];
    const initIdx = args.indexOf('init');
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(args.slice(initIdx)).toEqual(['init', 'foo']);
    expect(args).not.toContain('--description');

    expect(recorded[0]?.detached).toBe(true);
    expect(recorded[0]?.stdio).toEqual(['ignore', 'ignore', 'pipe']);
    expect(recorded[0]?.cwd).toBe(tmpProjectRoot);
    expect(recorded[0]?.env?.['SWT_PLANNING_ROOT']).toBe(
      path.join(tmpProjectRoot, '.swt-planning'),
    );
    expect(recorded[0]?.env?.['SWT_SESSION_ID']).toMatch(/^[0-9a-f-]{36}$/);
    expect(children[0]?.unref).toHaveBeenCalledTimes(1);
  });

  it('passes --description flag when description is provided', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);
    const { bus } = makeFakeBus();

    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo', description: 'bar baz' }),
    });
    expect(res.status).toBe(200);

    const args = recorded[0]?.args ?? [];
    const initIdx = args.indexOf('init');
    expect(args.slice(initIdx)).toEqual(['init', 'foo', '--description', 'bar baz']);
  });

  it('emits init.start to JSONL + bus.publish before subprocess exit', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);
    const { bus, publishFn } = makeFakeBus();

    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    // JSONL line 1 must parse cleanly via SnapshotEventSchema (proves the
    // round-trip from event-emission → JSONL → @swt-labs/shared schema).
    const lines = readInitEventsFile(tmpProjectRoot);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = SnapshotEventSchema.safeParse(JSON.parse(lines[0] as string));
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'init.start') {
      expect(parsed.data.session_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(parsed.data.name).toBe('foo');
    } else {
      throw new Error(`expected init.start, got ${(parsed as { data?: { type: string } }).data?.type ?? 'parse error'}`);
    }

    // bus.publish double-channel — the init.start object should also
    // have landed on the bus.
    expect(publishFn).toHaveBeenCalled();
    const startCall = publishFn.mock.calls.find(
      (call) => (call[0] as { type?: string })?.type === 'init.start',
    );
    expect(startCall).toBeDefined();
    expect((startCall?.[0] as { name?: string }).name).toBe('foo');
  });

  it('emits init.complete on clean exit (code 0)', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);
    const { bus, publishFn } = makeFakeBus();

    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    // Pump a clean exit through the watchdog.
    expect(children[0]?.exitCallbacks).toHaveLength(1);
    children[0]?.exitCallbacks[0]?.(0);

    const lines = readInitEventsFile(tmpProjectRoot);
    // Line 1 = init.start; line 2 = init.complete.
    expect(lines.length).toBe(2);
    const second = SnapshotEventSchema.safeParse(JSON.parse(lines[1] as string));
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data.type).toBe('init.complete');
      if (second.data.type === 'init.complete') {
        expect(second.data.status).toBe('success');
      }
    }

    // bus.publish double-channel for init.complete too.
    const completeCall = publishFn.mock.calls.find(
      (call) => (call[0] as { type?: string })?.type === 'init.complete',
    );
    expect(completeCall).toBeDefined();
  });

  it('emits init.error with INIT_SPAWN_FAILED on fast non-zero exit (<5s)', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);
    const { bus, publishFn } = makeFakeBus();

    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    // Pump a fast non-zero exit (synchronous — well under the 5s window).
    children[0]?.exitCallbacks[0]?.(3);

    const lines = readInitEventsFile(tmpProjectRoot);
    expect(lines.length).toBe(2);
    const second = SnapshotEventSchema.safeParse(JSON.parse(lines[1] as string));
    expect(second.success).toBe(true);
    if (second.success && second.data.type === 'init.error') {
      expect(second.data.code).toBe('INIT_SPAWN_FAILED');
      expect(second.data.message).toMatch(/exited with code 3 within \d+ms/);
    } else {
      throw new Error(`expected init.error, got ${(second as { data?: { type: string } }).data?.type ?? 'parse error'}`);
    }

    // bus.publish carries the init.error object (double-channel).
    const errorCall = publishFn.mock.calls.find(
      (call) => (call[0] as { type?: string })?.type === 'init.error',
    );
    expect(errorCall).toBeDefined();
    expect((errorCall?.[0] as { code?: string }).code).toBe('INIT_SPAWN_FAILED');
  });

  it('HTTP response is non-blocking (returns before subprocess exit)', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);
    const { bus } = makeFakeBus();

    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    // The response must have resolved BEFORE we drove any exit callback.
    // The watchdog handler is already registered (proves the spawn block
    // ran) but no completion/error event has fired yet.
    expect(children[0]?.exitCallbacks.length).toBe(1);
    const body = (await res.json()) as {
      initialized: boolean;
      root: string;
      files: string[];
    };
    expect(body.initialized).toBe(true);
    expect(body.root).toBe(tmpProjectRoot);
    expect(Array.isArray(body.files)).toBe(true);

    // Only init.start should be in the JSONL — no completion/error yet.
    const lines = readInitEventsFile(tmpProjectRoot);
    expect(lines.length).toBe(1);
    const parsed = SnapshotEventSchema.safeParse(JSON.parse(lines[0] as string));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe('init.start');
    }
  });

  it('does not throw when bus is omitted (graceful degradation)', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);

    const app = new Hono();
    // bus is intentionally omitted — the route should still scaffold +
    // respond 200, and the watchdog should not throw when invoked.
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: makeFakeInitProject(),
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(200);

    // init.start still landed in JSONL (the tailer-driven path is bus-
    // independent).
    const lines = readInitEventsFile(tmpProjectRoot);
    expect(lines.length).toBe(1);

    // Driving the watchdog should not throw.
    expect(() => {
      children[0]?.exitCallbacks[0]?.(0);
    }).not.toThrow();
  });

  it('does not spawn when initProject throws AlreadyInitializedError', async () => {
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);
    const { bus, publishFn } = makeFakeBus();
    const throwingInitProject = vi.fn().mockImplementation(() => {
      throw new AlreadyInitializedError(path.join(tmpProjectRoot, '.swt-planning'));
    });

    const app = new Hono();
    registerInitRoute(app, {
      projectRoot: tmpProjectRoot,
      onInitialized: vi.fn(),
      getSnapshot: () => null,
      bus,
      spawnFn: spawnFn as unknown as InitSpawnFn,
      initProject: throwingInitProject,
    });

    const res = await app.request('http://x/api/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    // AlreadyInitializedError surfaces as 409.
    expect(res.status).toBe(409);

    // Nothing should have been spawned and no init.start published.
    expect(recorded).toHaveLength(0);
    const startCalls = publishFn.mock.calls.filter(
      (call) => (call[0] as { type?: string })?.type === 'init.start',
    );
    expect(startCalls).toHaveLength(0);

    // No JSONL file at all — the route bailed out before .events/ was
    // touched.
    const eventsDir = path.join(tmpProjectRoot, '.swt-planning', '.events');
    expect(existsSync(eventsDir)).toBe(false);
  });
});

// Local alias used for the spawnFn cast. The route's seam type is
// `typeof node:child_process.spawn`, but the fake spawn has a narrower
// shape — casting through this alias keeps the test free of an `as any`
// while still exercising the production code path.
type InitSpawnFn = Parameters<typeof registerInitRoute>[1]['spawnFn'];
