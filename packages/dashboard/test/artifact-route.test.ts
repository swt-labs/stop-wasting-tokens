import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerArtifactRoute } from '../src/server/routes/artifact.js';

let projectRoot: string;
let app: Hono;

function setup(): void {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-art-'));
  mkdirSync(path.join(projectRoot, '.swt-planning'), { recursive: true });
  writeFileSync(
    path.join(projectRoot, '.swt-planning', 'STATE.md'),
    '---\nphase: 01\n---\n# State\n\nHello **world**.\n\n```ts\nconst a = 1;\n```\n',
  );
  // A non-allowlist file deliberately placed in the repo for testing
  writeFileSync(path.join(projectRoot, 'forbidden.txt'), 'do not serve');
}

async function fetch(pathQuery: string): Promise<Response> {
  return await app.request(`http://x${pathQuery}`);
}

describe('GET /api/artifact', () => {
  beforeEach(() => {
    setup();
    app = new Hono();
    registerArtifactRoute(app, projectRoot);
  });

  afterEach(() => {
    /* tmp dir cleanup is best-effort via OS */
  });

  it('returns raw markdown for an allowlisted file', async () => {
    const res = await fetch('/api/artifact?path=.swt-planning%2FSTATE.md');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    const body = await res.text();
    expect(body).toContain('# State');
    expect(body).toContain('Hello **world**.');
  });

  it('returns rendered HTML+frontmatter when render=html', async () => {
    const res = await fetch('/api/artifact?path=.swt-planning%2FSTATE.md&render=html');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { html: string; frontmatter: Record<string, unknown> };
    expect(body.html).toContain('<h1>State</h1>');
    expect(body.html).toContain('<strong>world</strong>');
    expect(body.html).toContain('class="language-ts"');
    expect(body.frontmatter['phase']).toBe(1);
  });

  it('rejects path traversal (../)', async () => {
    const res = await fetch('/api/artifact?path=..%2F..%2F..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
  });

  it('rejects encoded path traversal (%2e%2e%2f)', async () => {
    const res = await fetch('/api/artifact?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    expect(res.status).toBe(400);
  });

  it('rejects out-of-allowlist paths (e.g. forbidden.txt at repo root)', async () => {
    const res = await fetch('/api/artifact?path=forbidden.txt');
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing files inside the allowlist', async () => {
    const res = await fetch('/api/artifact?path=.swt-planning%2Fmissing.md');
    expect(res.status).toBe(404);
  });

  it('rejects empty path', async () => {
    const res = await fetch('/api/artifact?path=');
    expect(res.status).toBe(400);
  });

  it('rejects absolute paths', async () => {
    const res = await fetch('/api/artifact?path=%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
  });
});
