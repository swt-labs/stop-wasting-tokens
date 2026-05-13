/**
 * Plan 04-02 T4 — `GET /api/artifact-history`.
 *
 * Returns the most recent commits that touched an allowlisted artifact (
 * `.swt-planning/...`). Shells out to `git log --pretty=...` rather than
 * pulling in a JS git library — the data is small (10–50 commits), the
 * format is stable, and we already trust the user's local `git` for every
 * other dashboard read.
 *
 * Safety:
 *   - path goes through resolveSafePath (allowlist = ['.swt-planning/']), so
 *     no `../../etc/passwd` and no symlink escapes.
 *   - limit is clamped to [1, 50] to bound the shell-out duration.
 *   - the spawn passes args as an argv array (no shell interpretation),
 *     so a path or limit value cannot inject extra commands.
 */

import { spawn } from 'node:child_process';

import type { Hono } from 'hono';

import { resolveSafePath } from '../lib/safe-path.js';

const ALLOWLIST = ['.swt-planning/'] as const;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const GIT_TIMEOUT_MS = 10_000;

export interface ArtifactHistoryCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export function registerArtifactHistoryRoute(app: Hono, projectRoot: string): void {
  app.get('/api/artifact-history', async (c) => {
    const requested = c.req.query('path') ?? '';
    const decoded = (() => {
      try {
        return decodeURIComponent(requested);
      } catch {
        return requested;
      }
    })();
    const limitRaw = c.req.query('limit');
    const limitParsed = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : DEFAULT_LIMIT;
    const limit = Number.isFinite(limitParsed)
      ? Math.max(1, Math.min(MAX_LIMIT, limitParsed))
      : DEFAULT_LIMIT;

    const result = resolveSafePath(decoded, { projectRoot, allowlist: ALLOWLIST });
    if (!result.ok) {
      return c.json({ error: result.reason }, result.status);
    }

    const commits = await new Promise<ArtifactHistoryCommit[] | null>((resolve) => {
      const buf: string[] = [];
      const errBuf: string[] = [];
      const git = spawn(
        'git',
        ['log', '--pretty=format:%H|%s|%an|%aI', '-n', String(limit), '--', result.relPath],
        { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let settled = false;
      const settle = (value: ArtifactHistoryCommit[] | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => {
        git.kill('SIGTERM');
        settle(null);
      }, GIT_TIMEOUT_MS);
      git.stdout?.on('data', (chunk: Buffer) => buf.push(chunk.toString('utf8')));
      git.stderr?.on('data', (chunk: Buffer) => errBuf.push(chunk.toString('utf8')));
      git.once('error', () => {
        clearTimeout(timer);
        settle(null);
      });
      git.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          settle([]);
          return;
        }
        const out = buf.join('').trim();
        if (out.length === 0) {
          settle([]);
          return;
        }
        const parsed = out
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => {
            const [sha = '', message = '', author = '', date = ''] = line.split('|');
            return { sha, message, author, date };
          });
        settle(parsed);
      });
    });

    if (commits === null) {
      return c.json({ error: 'git log failed' }, 500);
    }
    return c.json({ commits });
  });
}
