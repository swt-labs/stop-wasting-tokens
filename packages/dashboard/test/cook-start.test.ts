import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { registerCookStartRoute } from '../src/server/routes/cook-start.js';

/**
 * Plan 04-02 T3 — `POST /api/cook/start` must:
 *   1. Return {session_id, pid, started_at} with a non-empty UUID-shaped id
 *   2. Spawn the subprocess with detached + ignored stdio so the dashboard
 *      isn't kept alive on cook exit
 *   3. Pass SWT_SESSION_ID in env so cook's resolveSessionId() adopts the id
 */

interface FakeChild {
  pid: number;
  unref: ReturnType<typeof vi.fn>;
}

interface RecordedSpawn {
  command: string;
  args: ReadonlyArray<string>;
  env: NodeJS.ProcessEnv | undefined;
  detached: boolean | undefined;
  stdio: unknown;
  cwd: string | undefined;
}

function makeFakeSpawn(recorded: RecordedSpawn[]): {
  spawnFn: (command: string, args: ReadonlyArray<string>, opts: Record<string, unknown>) => FakeChild;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  return {
    spawnFn: ((command, args, opts) => {
      recorded.push({
        command,
        args: [...args],
        env: opts['env'] as NodeJS.ProcessEnv | undefined,
        detached: opts['detached'] as boolean | undefined,
        stdio: opts['stdio'],
        cwd: opts['cwd'] as string | undefined,
      });
      const child: FakeChild = { pid: 99000 + children.length, unref: vi.fn() };
      children.push(child);
      return child;
    }) as unknown as typeof import('node:child_process').spawn,
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
    expect(recorded[0]?.stdio).toBe('ignore');
    expect(recorded[0]?.cwd).toBe(projectRoot);
    expect(recorded[0]?.env?.['SWT_SESSION_ID']).toBe(body.session_id);
    expect(recorded[0]?.env?.['SWT_PLANNING_ROOT']).toBe(
      path.join(projectRoot, '.swt-planning'),
    );
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
});
