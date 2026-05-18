import { readFile } from 'node:fs/promises';

import type { Hono } from 'hono';

import { resolveSafePath } from '../lib/safe-path.js';
import { renderMarkdown } from '../markdown/render.js';

// B-13: dropped 'dist/' from the allowlist. The only legitimate user of
// dist/ paths was the SPA reading its own bundled JS, which is handled by
// serveStatic in server/index.ts (registerSpaRoutes). Letting clients GET
// arbitrary dist/ paths via /api/artifact was unnecessary surface area.
const ALLOWLIST = ['.swt-planning/'] as const;

export function registerArtifactRoute(app: Hono, getProjectRoot: () => string | null): void {
  app.get('/api/artifact', async (c) => {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      return c.json({ error: 'dashboard not yet initialized — run `swt init` then retry' }, 503);
    }
    const requested = c.req.query('path') ?? '';
    const decoded = (() => {
      try {
        return decodeURIComponent(requested);
      } catch {
        return requested;
      }
    })();

    const renderHtml = c.req.query('render') === 'html';

    const result = resolveSafePath(decoded, {
      projectRoot,
      allowlist: ALLOWLIST,
    });

    if (!result.ok) {
      return c.json({ error: result.reason }, result.status);
    }

    let source: string;
    try {
      source = await readFile(result.absPath, 'utf8');
    } catch {
      return c.json({ error: 'file read failed' }, 500);
    }

    if (!renderHtml) {
      return c.body(source, 200, {
        'content-type': 'text/markdown; charset=utf-8',
      });
    }

    if (!result.relPath.endsWith('.md')) {
      return c.json({ error: 'render=html only supported for .md files' }, 400);
    }

    try {
      const rendered = await renderMarkdown(source);
      return c.json(rendered);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'markdown render failed', detail: message }, 500);
    }
  });
}
