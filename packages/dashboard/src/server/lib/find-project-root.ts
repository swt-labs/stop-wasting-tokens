import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class ProjectNotFoundError extends Error {
  override readonly name = 'ProjectNotFoundError';
}

const PLANNING_DIR = '.swt-planning';

/**
 * Walk up from {start} until a directory containing `.swt-planning/` is found.
 * Throws ProjectNotFoundError on reaching the filesystem root, the user's
 * home directory (B-14), or the start dir's mount boundary without a hit.
 *
 * The home-dir cap closes B-14: previously the walk continued to `/`, so a
 * `~/.swt-planning/` (e.g., a global SWT setup) would be picked up by ANY
 * deeply-nested project that lacked its own. Capping at $HOME makes the
 * walk respect user-scoped vs system-scoped project boundaries.
 */
export function findProjectRoot(start: string = process.cwd()): string {
  const homeDir = os.homedir();
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, PLANNING_DIR);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return current;
    }
    // Stop after checking $HOME — don't walk past it.
    if (current === homeDir) {
      throw new ProjectNotFoundError(
        `No ${PLANNING_DIR}/ found in ${start} or any ancestor up to ${homeDir}; run \`swt init\` first`,
      );
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ProjectNotFoundError(
        `No ${PLANNING_DIR}/ found in ${start} or any ancestor; run \`swt init\` first`,
      );
    }
    current = parent;
  }
}
