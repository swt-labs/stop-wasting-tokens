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
    registerArtifactRoute(app, () => projectRoot);
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
    // Syntax highlighting fired — shiki replaces the inner content of the
    // <code> block with styled <span> tokens carrying inline colors. The v2
    // assertion checked for `class="language-ts"` but `@shikijs/rehype` (as
    // configured + sanitized here) strips the language class and emits
    // styled spans instead. Match the styled-span markup to verify shiki ran.
    expect(body.html).toContain('<pre><code>');
    expect(body.html).toMatch(/<span style="color:#[0-9A-Fa-f]+">[^<]+<\/span>/);
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

describe('GET /api/artifact — greenfield (null getter)', () => {
  it('returns 503 with body containing "not yet initialized" when getProjectRoot returns null', async () => {
    const greenApp = new Hono();
    registerArtifactRoute(greenApp, () => null);
    const res = await greenApp.request('http://x/api/artifact?path=anything');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/dashboard not yet initialized/);
  });

  it('late-assign: 503 → 200 after getter starts returning a valid root', async () => {
    let mutableRoot: string | null = null;
    const lateApp = new Hono();
    registerArtifactRoute(lateApp, () => mutableRoot);

    const res1 = await lateApp.request('http://x/api/artifact?path=.swt-planning%2FSTATE.md');
    expect(res1.status).toBe(503);

    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'swt-art-late-'));
    mkdirSync(path.join(tmpRoot, '.swt-planning'), { recursive: true });
    writeFileSync(path.join(tmpRoot, '.swt-planning', 'STATE.md'), '# Late\n');
    mutableRoot = tmpRoot;

    const res2 = await lateApp.request('http://x/api/artifact?path=.swt-planning%2FSTATE.md');
    expect(res2.status).toBe(200);
  });
});
