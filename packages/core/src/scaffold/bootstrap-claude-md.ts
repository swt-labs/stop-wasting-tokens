/**
 * `bootstrapClaudeMd` — synchronous wrapper around
 * `scripts/bootstrap/bootstrap-claude.sh`.
 *
 * Plan 23-01-01 T02 (milestone 23, Phase 01). Called by `initProject()`
 * AFTER write-config-json + sync-gitignore but BEFORE install-git-hooks.
 * The script generates or updates `CLAUDE.md` with SWT-managed sections.
 *
 * Mode selection (AC 17 — user-content preservation):
 *   - If `<cwd>/CLAUDE.md` exists, pass its path as the 4th positional arg
 *     so the script preserves user-owned content (strips ONLY SWT-managed
 *     + GSD sections, migrates deprecated "Key Decisions" tables, then
 *     regenerates SWT sections).
 *   - If absent, omit the 4th arg → new-file mode (creates fresh
 *     SWT-managed CLAUDE.md).
 *
 * `execFileSync` with array argv form avoids shell-injection on
 * user-supplied project names + core-value text.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function bootstrapClaudeMd(
  cwd: string,
  pluginRoot: string,
  projectName: string,
  coreValue: string,
): void {
  const scriptPath = path.join(pluginRoot, 'scripts', 'bootstrap', 'bootstrap-claude.sh');
  const outputPath = path.join(cwd, 'CLAUDE.md');
  const existingPath = existsSync(outputPath) ? outputPath : undefined;

  const args = [
    scriptPath,
    outputPath,
    projectName,
    coreValue,
    ...(existingPath !== undefined ? [existingPath] : []),
  ];

  try {
    execFileSync('bash', args, {
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
      `bootstrapClaudeMd: bootstrap-claude.sh failed (${message})${
        stderr.length > 0 ? `\nstderr: ${stderr}` : ''
      }`,
    );
  }
}
