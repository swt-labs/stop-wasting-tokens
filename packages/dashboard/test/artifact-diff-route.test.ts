import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerArtifactDiffRoute } from '../src/server/routes/artifact-diff.ts';

let projectRoot: string;
let app: Hono;

function setupRepoWithChange(root: string): void {
  mkdirSync(path.join(root, '.swt-planning', 'phases', '01'), { recursive: true });
  const planPath = path.join(root, '.swt-planning', 'phases', '01', '01-PLAN.md');
  writeFileSync(planPath, '# Plan v1\n');
  execSync('git init -q', { cwd: root });
  execSync('git add -A', { cwd: root });
  execSync(
    'git -c user.email=t@t -c user.name=t commit -q -m "v1"',
    { cwd: root },
  );
  // Make a second commit so HEAD~1 resolves.
  writeFileSync(planPath, '# Plan v2\n');
  execSync('git add -A', { cwd: root });
  execSync(
    'git -c user.email=t@t -c user.name=t commit -q -m "v2"',
    { cwd: root },
  );
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-diff-route-'));
  app = new Hono();
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('GET /api/artifact-diff', () => {
  it('returns 503 with body containing "not yet initialized" when getProjectRoot returns null', async () => {
    registerArtifactDiffRoute(app, () => null);
    const res = await app.request(
      'http://x/api/artifact-diff?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/dashboard not yet initialized/);
  });

  it('returns 200 with {diff} shape when projectRoot is set', async () => {
    setupRepoWithChange(projectRoot);
    registerArtifactDiffRoute(app, () => projectRoot);
    const res = await app.request(
      'http://x/api/artifact-diff?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: unknown };
    expect(typeof body.diff).toBe('string');
  });

  it('late-assign: 503 → 200 after getter starts returning a valid root', async () => {
    let mutableRoot: string | null = null;
    registerArtifactDiffRoute(app, () => mutableRoot);

    const res1 = await app.request(
      'http://x/api/artifact-diff?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res1.status).toBe(503);

    setupRepoWithChange(projectRoot);
    mutableRoot = projectRoot;

    const res2 = await app.request(
      'http://x/api/artifact-diff?path=.swt-planning%2Fphases%2F01%2F01-PLAN.md',
    );
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { diff: unknown };
    expect(typeof body.diff).toBe('string');
  });
});
