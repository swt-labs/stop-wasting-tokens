/**
 * `GET /api/init-precheck` route tests.
 *
 * Milestone 23 Phase 01 T03 — read-only auto-detection for the wizard's
 * Step 1 render. The route must return one of two discriminated shapes:
 *
 *   - `{ already_initialized: true }` when `.swt-planning/PROJECT.md` exists.
 *   - `{ already_initialized: false, brownfield, source_file_count, git }`
 *     for the four greenfield / brownfield × cwd-git / parent-git / no-git
 *     combinations.
 *
 * The route is purely read-only — it never mutates the project dir. Each
 * test uses a fresh tmpdir as `projectRoot`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerInitPrecheckRoute } from '../../src/server/routes/init-precheck.js';

describe('GET /api/init-precheck', () => {
  let tmpProjectRoot: string;

  beforeEach(() => {
    tmpProjectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'init-precheck-test-')));
  });

  afterEach(() => {
    rmSync(tmpProjectRoot, { recursive: true, force: true });
  });

  it('greenfield + no git: returns { already_initialized: false, brownfield: false, source_file_count: 0, git: "absent" }', async () => {
    const app = new Hono();
    registerInitPrecheckRoute(app, { projectRoot: tmpProjectRoot });

    const res = await app.request('http://x/api/init-precheck');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      already_initialized: boolean;
      brownfield?: boolean;
      source_file_count?: number;
      git?: string;
    };
    expect(body.already_initialized).toBe(false);
    expect(body.brownfield).toBe(false);
    expect(body.source_file_count).toBe(0);
    expect(body.git).toBe('absent');
  });

  it('brownfield + git in cwd: returns { brownfield: true, source_file_count > 0, git: "repo" }', async () => {
    // Drop a tsconfig.json + src/index.ts so detectBrownfield trips.
    writeFileSync(
      path.join(tmpProjectRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
      'utf8',
    );
    mkdirSync(path.join(tmpProjectRoot, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmpProjectRoot, 'src', 'index.ts'),
      `export const hello = 'world';\n`,
      'utf8',
    );
    // Initialize a git repo at the project root.
    execFileSync('git', ['init'], { cwd: tmpProjectRoot, stdio: 'pipe' });

    const app = new Hono();
    registerInitPrecheckRoute(app, { projectRoot: tmpProjectRoot });

    const res = await app.request('http://x/api/init-precheck');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      already_initialized: boolean;
      brownfield?: boolean;
      source_file_count?: number;
      git?: string;
    };
    expect(body.already_initialized).toBe(false);
    expect(body.brownfield).toBe(true);
    expect(body.source_file_count).toBeGreaterThan(0);
    expect(body.git).toBe('repo');
  });

  it('in parent repo: returns { brownfield: false, source_file_count: 0, git: "parent_repo" }', async () => {
    // Initialize a git repo at the tmpdir, then create a nested project
    // root one level down. The nested dir has no git of its own.
    execFileSync('git', ['init'], { cwd: tmpProjectRoot, stdio: 'pipe' });
    const nested = path.join(tmpProjectRoot, 'nested');
    mkdirSync(nested, { recursive: true });

    const app = new Hono();
    registerInitPrecheckRoute(app, { projectRoot: nested });

    const res = await app.request('http://x/api/init-precheck');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      already_initialized: boolean;
      brownfield?: boolean;
      source_file_count?: number;
      git?: string;
    };
    expect(body.already_initialized).toBe(false);
    expect(body.brownfield).toBe(false);
    expect(body.source_file_count).toBe(0);
    expect(body.git).toBe('parent_repo');
  });

  it('already initialized: returns { already_initialized: true } and nothing else', async () => {
    // Drop a .swt-planning/PROJECT.md marker.
    mkdirSync(path.join(tmpProjectRoot, '.swt-planning'), { recursive: true });
    writeFileSync(
      path.join(tmpProjectRoot, '.swt-planning', 'PROJECT.md'),
      `# initialized\n`,
      'utf8',
    );

    const app = new Hono();
    registerInitPrecheckRoute(app, { projectRoot: tmpProjectRoot });

    const res = await app.request('http://x/api/init-precheck');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['already_initialized']).toBe(true);
    // No other fields surface on the already-initialized branch — the
    // wizard's Step 1 short-circuits the form when this flag is true.
    expect(body['brownfield']).toBeUndefined();
    expect(body['source_file_count']).toBeUndefined();
    expect(body['git']).toBeUndefined();
  });
});
