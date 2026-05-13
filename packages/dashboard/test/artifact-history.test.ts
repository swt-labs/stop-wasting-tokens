import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerArtifactDiffRoute } from '../src/server/routes/artifact-diff.js';
import {
  registerArtifactHistoryRoute,
  type ArtifactHistoryCommit,
} from '../src/server/routes/artifact-history.js';

/**
 * Plan 04-02 T4 — `GET /api/artifact-history` + `GET /api/artifact-diff`.
 * Tests use a real temp git repo so the route's spawn('git', ...) walks the
 * same code path as production.
 */

let projectRoot: string;
let app: Hono;

function gitInit(): void {
  execSync('git init -q', { cwd: projectRoot });
  execSync('git config user.email test@example.com', { cwd: projectRoot });
  execSync('git config user.name "Test User"', { cwd: projectRoot });
  execSync('git config commit.gpgsign false', { cwd: projectRoot });
}

function gitCommit(message: string): void {
  execSync('git add .', { cwd: projectRoot });
  execSync(`git commit -q -m "${message}"`, { cwd: projectRoot });
}

function setup(): void {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-art-hist-'));
  mkdirSync(path.join(projectRoot, '.swt-planning'), { recursive: true });
  writeFileSync(
    path.join(projectRoot, '.swt-planning', 'STATE.md'),
    '# State v1\n\nInitial body.\n',
  );
  gitInit();
  gitCommit('first commit');
  writeFileSync(
    path.join(projectRoot, '.swt-planning', 'STATE.md'),
    '# State v2\n\nUpdated body.\n',
  );
  gitCommit('second commit');
}

describe('GET /api/artifact-history', () => {
  beforeEach(() => {
    setup();
    app = new Hono();
    registerArtifactHistoryRoute(app, projectRoot);
  });

  afterEach(() => {
    /* tmp dir cleanup is best-effort via OS */
  });

  it('returns a list of recent commits touching the artifact', async () => {
    const res = await app.request(
      `http://x/api/artifact-history?path=${encodeURIComponent('.swt-planning/STATE.md')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commits: ArtifactHistoryCommit[] };
    expect(body.commits.length).toBeGreaterThanOrEqual(2);
    expect(body.commits[0]?.message).toBe('second commit');
    expect(body.commits[1]?.message).toBe('first commit');
    expect(body.commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(body.commits[0]?.author).toBe('Test User');
    expect(body.commits[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('honors a limit query parameter', async () => {
    const res = await app.request(
      `http://x/api/artifact-history?path=${encodeURIComponent('.swt-planning/STATE.md')}&limit=1`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commits: ArtifactHistoryCommit[] };
    expect(body.commits).toHaveLength(1);
  });

  it('rejects path traversal attempts with 400', async () => {
    const res = await app.request(
      `http://x/api/artifact-history?path=${encodeURIComponent('../../etc/passwd')}`,
    );
    expect(res.status).toBe(400);
  });

  it('rejects paths outside the .swt-planning/ allowlist with 400', async () => {
    writeFileSync(path.join(projectRoot, 'forbidden.txt'), 'do not serve');
    gitCommit('add forbidden');
    const res = await app.request('http://x/api/artifact-history?path=forbidden.txt');
    expect(res.status).toBe(400);
  });

  it('returns an empty commit list for an untracked allowlisted file', async () => {
    writeFileSync(path.join(projectRoot, '.swt-planning', 'fresh.md'), 'never committed');
    const res = await app.request(
      `http://x/api/artifact-history?path=${encodeURIComponent('.swt-planning/fresh.md')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commits: ArtifactHistoryCommit[] };
    expect(body.commits).toEqual([]);
  });
});

describe('GET /api/artifact-diff', () => {
  beforeEach(() => {
    setup();
    app = new Hono();
    registerArtifactDiffRoute(app, projectRoot);
  });

  it('returns the unified diff between HEAD~1 and working tree', async () => {
    const res = await app.request(
      `http://x/api/artifact-diff?path=${encodeURIComponent('.swt-planning/STATE.md')}&base=HEAD~1`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: string };
    expect(body.diff).toContain('diff --git');
    expect(body.diff).toContain('-# State v1');
    expect(body.diff).toContain('+# State v2');
  });

  it('rejects shell-injection-shaped base refs with 400', async () => {
    const res = await app.request(
      `http://x/api/artifact-diff?path=${encodeURIComponent('.swt-planning/STATE.md')}&base=${encodeURIComponent('HEAD; rm -rf /')}`,
    );
    expect(res.status).toBe(400);
  });

  it('rejects path traversal with 400', async () => {
    const res = await app.request(
      `http://x/api/artifact-diff?path=${encodeURIComponent('../../etc/passwd')}`,
    );
    expect(res.status).toBe(400);
  });
});
