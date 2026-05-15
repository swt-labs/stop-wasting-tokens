import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { EventBus } from '../src/server/event-bus.js';
import { registerCookStartRoute } from '../src/server/routes/cook-start.js';

/**
 * Plan 04-02 T3 + Phase 01 (Cook IPC plumbing) — `POST /api/cook/start` must:
 *   1. Return {session_id, pid, started_at} with a non-empty UUID-shaped id
 *   2. Spawn the subprocess with detached + piped-stderr stdio so the
 *      daemon can wrap cook's stderr as `log.append` rows
 *   3. Pass SWT_SESSION_ID in env so cook's resolveSessionId() adopts the id
 *   4. Write `.swt-planning/.pending-scope-idea.txt` BEFORE spawn when the
 *      request body carries a non-empty `prompt`
 *   5. Surface a fast non-zero exit as a bus `error` event so the
 *      dashboard's pushError handler can toast it
 */

/**
 * Minimal stderr stream shape the route's handler reads (`on('data', cb)`
 * + `unref()`). The "publishes error" test below also stores the data
 * callback so it could pump synthetic lines through; the other tests do
 * not emit chunks — they just need the shape to exist so the route's
 * attach-listener code path runs without TypeError.
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
        pid: 99000 + children.length,
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

describe('POST /api/cook/start', () => {
  it('returns session_id + pid + started_at, and spawns swt cook detached', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-cook-start-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);

    const app = new Hono();
    registerCookStartRoute(app, { projectRoot, spawnFn });

    const res = await app.request('http://x/api/cook/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session_id: string; pid: number; started_at: string };
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.pid).toBe(children[0]?.pid);
    expect(typeof body.started_at).toBe('string');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.args).toContain('cook');
    expect(recorded[0]?.detached).toBe(true);
    // Phase 01 (Cook IPC plumbing) — stdio is a 3-tuple now so the daemon
    // can read child.stderr and wrap each line as a `log.append` row.
    // stdout stays `'ignore'` because cook's structured output already
    // flows through its own cook-events JSONL (no need to duplicate).
    expect(recorded[0]?.stdio).toEqual(['ignore', 'ignore', 'pipe']);
    expect(recorded[0]?.cwd).toBe(projectRoot);
    expect(recorded[0]?.env?.['SWT_SESSION_ID']).toBe(body.session_id);
    expect(recorded[0]?.env?.['SWT_PLANNING_ROOT']).toBe(path.join(projectRoot, '.swt-planning'));
    expect(children[0]?.unref).toHaveBeenCalledTimes(1);
  });

  it('forwards optional args[] to swt cook', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-cook-start-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);

    const app = new Hono();
    registerCookStartRoute(app, { projectRoot, spawnFn });

    const res = await app.request('http://x/api/cook/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: ['--execute', '--phase', '04'] }),
    });
    expect(res.status).toBe(200);

    const cookIdx = recorded[0]?.args.indexOf('cook') ?? -1;
    expect(cookIdx).toBeGreaterThanOrEqual(0);
    const forwarded = recorded[0]?.args.slice(cookIdx + 1) ?? [];
    expect(forwarded).toEqual(['--execute', '--phase', '04']);
  });

  it('returns a fresh session_id on every request', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-cook-start-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);
    const app = new Hono();
    registerCookStartRoute(app, { projectRoot, spawnFn });

    const a = (await (
      await app.request('http://x/api/cook/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json()) as { session_id: string };
    const b = (await (
      await app.request('http://x/api/cook/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json()) as { session_id: string };
    expect(a.session_id).not.toBe(b.session_id);
  });

  // ─── Phase 01 (Cook IPC plumbing) — new invariants ──────────────────────
  it('writes .pending-scope-idea.txt seed file when prompt is non-empty', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-cook-start-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn } = makeFakeSpawn(recorded);

    const app = new Hono();
    registerCookStartRoute(app, { projectRoot, spawnFn });

    const res = await app.request('http://x/api/cook/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'build a snake game' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session_id: string };
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);

    const seedPath = path.join(projectRoot, '.swt-planning', '.pending-scope-idea.txt');
    expect(existsSync(seedPath)).toBe(true);
    // No trailing newline — the route writes the trimmed prompt as-is.
    expect(readFileSync(seedPath, 'utf8')).toBe('build a snake game');
  });

  it('does not create seed file when prompt is empty or absent', async () => {
    const bodies: Array<Record<string, unknown>> = [
      {}, // no prompt field
      { prompt: '' }, // empty string
      { prompt: '   ' }, // whitespace only
    ];

    for (const reqBody of bodies) {
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-cook-start-'));
      const recorded: RecordedSpawn[] = [];
      const { spawnFn } = makeFakeSpawn(recorded);

      const app = new Hono();
      registerCookStartRoute(app, { projectRoot, spawnFn });

      const res = await app.request('http://x/api/cook/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      expect(res.status).toBe(200);
      const seedPath = path.join(projectRoot, '.swt-planning', '.pending-scope-idea.txt');
      expect(existsSync(seedPath)).toBe(false);
    }
  });

  it('publishes error event on bus when cook exits nonzero within 5s', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-cook-start-'));
    const recorded: RecordedSpawn[] = [];
    const { spawnFn, children } = makeFakeSpawn(recorded);

    // Minimal fake EventBus — record publish() calls; subscribe/size are
    // unused by the route but the interface requires them so the seam
    // typechecks.
    const publishFn = vi.fn();
    const bus: EventBus = {
      publish: publishFn,
      subscribe: () => () => {
        /* noop */
      },
      size: () => 0,
    };

    const app = new Hono();
    registerCookStartRoute(app, { projectRoot, spawnFn, bus });

    const res = await app.request('http://x/api/cook/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'build a snake game' }),
    });
    expect(res.status).toBe(200);

    // The route attached a `once('exit', ...)` callback synchronously
    // during the request. Pump a fast non-zero exit through it.
    expect(children[0]?.exitCallbacks.length).toBe(1);
    children[0]?.exitCallbacks[0]?.(1);

    expect(publishFn).toHaveBeenCalledTimes(1);
    const publishedArg = publishFn.mock.calls[0]?.[0] as
      | { type: string; code: string; message: string }
      | undefined;
    expect(publishedArg?.type).toBe('error');
    expect(publishedArg?.code).toBe('COOK_SPAWN_FAILED');
    expect(typeof publishedArg?.message).toBe('string');
  });
});
