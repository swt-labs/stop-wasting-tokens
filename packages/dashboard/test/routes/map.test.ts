import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MapStartResponseSchema } from '@swt-labs/shared';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { EventBus } from '../../src/server/event-bus.js';
import { registerMapRoute } from '../../src/server/routes/map.js';

/**
 * Milestone 23 Phase 03 T01 — `POST /api/map` must:
 *   1. Return {session_id, pid, started_at} with a UUID-shaped id (and
 *      pass MapStartResponseSchema validation).
 *   2. Spawn the subprocess detached with stderr piped + env carrying
 *      SWT_SESSION_ID + SWT_PLANNING_ROOT.
 *   3. Surface a non-zero fast exit as a `bus.publish({type:'error',
 *      code:'MAP_SPAWN_FAILED'})` so the dashboard's pushError surfaces
 *      a toast immediately, bypassing the events-tailer.
 *   4. Accept an empty body (no required fields).
 */

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

describe('POST /api/map', () => {
  it('returns session_id + pid + started_at, spawning swt map detached', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-map-route-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);

    const app = new Hono();
    registerMapRoute(app, { projectRoot, spawnFn });

    const res = await app.request('http://x/api/map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    // Validates the wire contract end-to-end (Scout Drift 6 — MapStartResponseSchema
    // is the declarative contract in @swt-labs/shared).
    const parsed = MapStartResponseSchema.parse(body);
    expect(parsed.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.pid).toBe(children[0]?.pid);
    expect(typeof parsed.started_at).toBe('string');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.args).toContain('map');
    expect(recorded[0]?.detached).toBe(true);
    // Same stdio shape as cook-start so the daemon can wrap stderr as
    // `log.append` rows and the events-tailer picks them up.
    expect(recorded[0]?.stdio).toEqual(['ignore', 'ignore', 'pipe']);
    expect(recorded[0]?.cwd).toBe(projectRoot);
    expect(recorded[0]?.env?.['SWT_SESSION_ID']).toBe(parsed.session_id);
    expect(recorded[0]?.env?.['SWT_PLANNING_ROOT']).toBe(path.join(projectRoot, '.swt-planning'));
    expect(children[0]?.unref).toHaveBeenCalledTimes(1);
  });

  it('accepts a bare POST with no body', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-map-route-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);
    const app = new Hono();
    registerMapRoute(app, { projectRoot, spawnFn });

    const res = await app.request('http://x/api/map', { method: 'POST' });
    expect(res.status).toBe(200);
    const parsed = MapStartResponseSchema.parse(await res.json());
    expect(parsed.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.args).toContain('map');
  });

  it('returns a fresh session_id on every request', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-map-route-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);
    const app = new Hono();
    registerMapRoute(app, { projectRoot, spawnFn });

    const a = (await (await app.request('http://x/api/map', { method: 'POST' })).json()) as {
      session_id: string;
    };
    const b = (await (await app.request('http://x/api/map', { method: 'POST' })).json()) as {
      session_id: string;
    };
    expect(a.session_id).not.toBe(b.session_id);
  });

  it('publishes error event on bus when map exits nonzero within 5s', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-map-route-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);

    const publishFn = vi.fn();
    const bus: EventBus = {
      publish: publishFn,
      subscribe: () => () => {
        /* noop */
      },
      size: () => 0,
    };

    const app = new Hono();
    registerMapRoute(app, { projectRoot, spawnFn, bus });

    const res = await app.request('http://x/api/map', { method: 'POST' });
    expect(res.status).toBe(200);

    // Pump a fast non-zero exit through the attached watchdog callback.
    expect(children[0]?.exitCallbacks.length).toBe(1);
    children[0]?.exitCallbacks[0]?.(1);

    expect(publishFn).toHaveBeenCalledTimes(1);
    const publishedArg = publishFn.mock.calls[0]?.[0] as
      | { type: string; code: string; message: string }
      | undefined;
    expect(publishedArg?.type).toBe('error');
    expect(publishedArg?.code).toBe('MAP_SPAWN_FAILED');
    expect(typeof publishedArg?.message).toBe('string');
  });
});
