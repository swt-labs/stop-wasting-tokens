/**
 * `syncGitignore` — synchronous wrapper around `scripts/planning-git.sh
 * sync-ignore`.
 *
 * Plan 23-01-01 T02 (milestone 23, Phase 01). Called by `initProject()`
 * after writing config.json (AC 14): the script reads
 * `.swt-planning/config.json#planning_tracking` and rewrites the root
 * `.gitignore` + `.swt-planning/.gitignore` accordingly.
 *
 * Script behavior (verified by Scout):
 *   - `planning_tracking: 'manual'`  — `.swt-planning/` is gitignored as a
 *      whole; the user opts in by uncommenting.
 *   - `planning_tracking: 'ignore'` — same as manual but more aggressive.
 *   - `planning_tracking: 'commit'` — runtime/transient files in
 *      `.swt-planning/` are gitignored; PROJECT.md / STATE.md /
 *      REQUIREMENTS.md / ROADMAP.md / config.json are tracked.
 *
 * Idempotent + exits 0 outside git repos (safe regardless of git state at
 * call time, but `initProject()` orchestration runs this AFTER `initGit()`
 * has guaranteed a repo).
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PLANNING_DIR = '.swt-planning';

export function syncGitignore(cwd: string, pluginRoot: string): void {
  const scriptPath = path.join(pluginRoot, 'scripts', 'planning-git.sh');
  const configPath = path.join(cwd, PLANNING_DIR, 'config.json');
  try {
    execFileSync('bash', [scriptPath, 'sync-ignore', configPath], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (err: unknown) {
    const stderr =
      err !== null && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr ?? '')
        : '';
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `syncGitignore: planning-git.sh sync-ignore failed (${message})${
        stderr.length > 0 ? `\nstderr: ${stderr}` : ''
      }`,
    );
  }
}
