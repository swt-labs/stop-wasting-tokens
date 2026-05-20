/**
 * `GET /api/init-precheck` — read-only auto-detection for the wizard's
 * Step 1 render.
 *
 * Milestone 23 Phase 01 T03 — the wizard's Step 1 needs to know, before
 * the user chooses anything:
 *
 *   1. Is the project ALREADY initialized? (Short-circuits into the
 *      "already initialized" branch with a banner + reset CTA.)
 *   2. Otherwise, is this a brownfield project (has user source files)?
 *      The wizard renders "N source files detected — looks like a brownfield
 *      project" when `brownfield: true`.
 *   3. Otherwise, what's the git state? `'absent'` (no .git anywhere),
 *      `'repo'` (.git in cwd), or `'parent_repo'` (.git in a parent).
 *      Drives the "git init will create a new repo" / "we'll use your
 *      existing repo" / "we're inside a parent monorepo" hint.
 *
 * The route is purely read-only — it never mutates the project directory.
 * `detectGitState` from `@swt-labs/core/scaffold/init-git.js` is the
 * sibling export to `initGit` that wraps the same probe but never invokes
 * `git init`.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { detectBrownfield } from '@swt-labs/core/scaffold/detect-brownfield.js';
import { detectGitState } from '@swt-labs/core/scaffold/init-git.js';
import type { InitPrecheckResponse } from '@swt-labs/shared';
import type { Hono } from 'hono';

const PLANNING_DIR = '.swt-planning';

export interface InitPrecheckRouteOptions {
  /** Absolute project root the daemon is bound to. */
  projectRoot: string;
}

export function registerInitPrecheckRoute(app: Hono, opts: InitPrecheckRouteOptions): void {
  app.get('/api/init-precheck', (c) => {
    const cwd = opts.projectRoot;
    const planningExists = existsSync(path.join(cwd, PLANNING_DIR, 'PROJECT.md'));
    if (planningExists) {
      const body: InitPrecheckResponse = { already_initialized: true };
      return c.json(body);
    }
    const { brownfield, sourceFileCount } = detectBrownfield(cwd);
    const git = detectGitState(cwd);
    const body: InitPrecheckResponse = {
      already_initialized: false,
      brownfield,
      source_file_count: sourceFileCount,
      git,
    };
    return c.json(body);
  });
}
