import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export class ProjectNotFoundError extends Error {
  override readonly name = 'ProjectNotFoundError';
}

const PLANNING_DIR = '.swt-planning';

/**
 * Walk up from {start} until a directory containing `.swt-planning/` is found.
 * Throws ProjectNotFoundError on reaching the filesystem root without a hit.
 */
export function findProjectRoot(start: string = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, PLANNING_DIR);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return current;
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
