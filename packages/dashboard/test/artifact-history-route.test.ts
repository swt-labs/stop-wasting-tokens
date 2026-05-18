import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerArtifactHistoryRoute } from '../src/server/routes/artifact-history.ts';

let projectRoot: string;
let app: Hono;

function setupRepo(root: string): void {
  mkdirSync(path.join(root, '.swt-planning', 'phases', '01'), { recursive: true });
  writeFileSync(path.join(root, '.swt-planning', 'phases', '01', '01-PLAN.md'), '# Plan v1\n');
  execSync('git init -q', { cwd: root });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: root });
  execSync('git add -A', { cwd: root });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m "add plan"', { cwd: root });
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-hist-route-'));
  app = new Hono();
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('GET /api/artifact-history', () => {
  it('returns 503 with body containing "not yet initialized" when getProjectRoot returns null', async () => {
    registerArtifactHistoryRoute(app, () => null);
    const res = await app.request(
      'http://x/api/artifact-history?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/dashboard not yet initialized/);
  });

  it('returns 200 with {commits} shape when projectRoot is set', async () => {
    setupRepo(projectRoot);
    registerArtifactHistoryRoute(app, () => projectRoot);
    const res = await app.request(
      'http://x/api/artifact-history?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commits: unknown };
    expect(Array.isArray(body.commits)).toBe(true);
  });

  it('late-assign: 503 → 200 after getter starts returning a valid root', async () => {
    let mutableRoot: string | null = null;
    registerArtifactHistoryRoute(app, () => mutableRoot);

    const res1 = await app.request(
      'http://x/api/artifact-history?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res1.status).toBe(503);

    setupRepo(projectRoot);
    mutableRoot = projectRoot;

    const res2 = await app.request(
      'http://x/api/artifact-history?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { commits: unknown };
    expect(Array.isArray(body.commits)).toBe(true);
  });
});
