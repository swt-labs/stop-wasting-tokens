/**
 * Plan 04-02 T4 — `GET /api/artifact-diff`.
 *
 * Unified diff between `base` (default `HEAD~1`) and the working-tree copy
 * of an allowlisted artifact. Shells out to `git diff` for the same reasons
 * as artifact-history.ts (small payloads, stable format, no extra deps).
 *
 * Safety:
 *   - path → resolveSafePath (allowlist = ['.swt-planning/']).
 *   - base ref → strict regex (`[A-Za-z0-9~^_./-]+`) so a value like
 *     `; rm -rf /` cannot ride into the spawn. Args go through `spawn`'s
 *     argv array, but the defense-in-depth regex blocks even theoretical
 *     misuse of weird-but-shell-legal git refs.
 */

import { spawn } from 'node:child_process';

import type { Hono } from 'hono';

import { resolveSafePath } from '../lib/safe-path.js';

const ALLOWLIST = ['.swt-planning/'] as const;
const DEFAULT_BASE = 'HEAD~1';
const BASE_REF_PATTERN = /^[A-Za-z0-9~^_./-]+$/;
const GIT_TIMEOUT_MS = 10_000;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;

export function registerArtifactDiffRoute(app: Hono, getProjectRoot: () => string | null): void {
  app.get('/api/artifact-diff', async (c) => {
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
    const base = c.req.query('base') ?? DEFAULT_BASE;
    if (!BASE_REF_PATTERN.test(base)) {
      return c.json({ error: 'invalid base ref' }, 400);
    }

    const result = resolveSafePath(decoded, { projectRoot, allowlist: ALLOWLIST });
    if (!result.ok) {
      return c.json({ error: result.reason }, result.status);
    }

    const diff = await new Promise<string | null>((resolve) => {
      const buf: string[] = [];
      let bytes = 0;
      let truncated = false;
      const git = spawn('git', ['diff', base, '--', result.relPath], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let settled = false;
      const settle = (value: string | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => {
        git.kill('SIGTERM');
        settle(null);
      }, GIT_TIMEOUT_MS);
      git.stdout?.on('data', (chunk: Buffer) => {
        if (truncated) return;
        bytes += chunk.length;
        if (bytes > MAX_DIFF_BYTES) {
          truncated = true;
          git.kill('SIGTERM');
          return;
        }
        buf.push(chunk.toString('utf8'));
      });
      git.once('error', () => {
        clearTimeout(timer);
        settle(null);
      });
      git.once('close', () => {
        clearTimeout(timer);
        settle(buf.join(''));
      });
    });

    if (diff === null) {
      return c.json({ error: 'git diff failed' }, 500);
    }
    return c.json({ diff });
  });
}
