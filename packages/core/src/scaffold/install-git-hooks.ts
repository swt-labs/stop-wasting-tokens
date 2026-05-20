/**
 * `installGitHooks` — synchronous wrapper around `scripts/install-hooks.sh`.
 *
 * Plan 23-01-01 T02 (milestone 23, Phase 01). Called by `initProject()`
 * AFTER `initGit()` guarantees a git repo (AC 15). The script installs
 * `.git/hooks/pre-push` which delegates to
 * `${SWT_INSTALL_ROOT}/scripts/pre-push-hook.sh`. Idempotent + exits 0
 * outside git repos.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { extractStderr } from './errors.js';

export function installGitHooks(cwd: string, pluginRoot: string): void {
  const scriptPath = path.join(pluginRoot, 'scripts', 'install-hooks.sh');
  try {
    execFileSync('bash', [scriptPath], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      env: {
        ...process.env,
        // The hook body it installs reads SWT_INSTALL_ROOT at runtime; set
        // it here so the installed hook resolves the upstream script
        // location correctly even when the user later invokes `git push`
        // from a stripped environment (git hooks run with PATH but not
        // necessarily SWT_*).
        SWT_INSTALL_ROOT: pluginRoot,
      },
    });
  } catch (err: unknown) {
    const stderr = extractStderr(err);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `installGitHooks: install-hooks.sh failed (${message})${
        stderr.length > 0 ? `\nstderr: ${stderr}` : ''
      }`,
    );
  }
}
