import { readdirSync } from 'node:fs';

/**
 * Names that don't count toward "user has a codebase here." Anything starting
 * with `.` (hidden files like `.git`, `.DS_Store`, `.swt-planning`) is also
 * skipped before this set is consulted, so this list only needs to cover
 * non-hidden noise: package-manager output, build artifacts, virtual envs.
 */
const IGNORED_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.next',
  '.venv',
  'target', // Rust
  'vendor', // Go / PHP
  'Thumbs.db',
]);

/**
 * Greenfield-vs-brownfield heuristic for the dashboard daemon's cwd.
 *
 * Returns true when the cwd contains at least one non-hidden, non-ignored
 * file or directory — meaning the user has an existing project here that
 * SWT could plausibly be set up around. Returns false for pure-greenfield
 * directories (empty, or only contains hidden/ignored entries).
 *
 * Mirrors `/vbw:init`'s brownfield detection rule: any tracked source
 * counts; build artifacts and dotfiles don't. The check is intentionally
 * conservative — we'd rather miss "this is a brownfield project" than
 * falsely tell a user "you have a codebase here" when they don't.
 *
 * Single fs.readdir; meant to be called once at daemon startup.
 */
export function detectBrownfield(cwd: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(cwd);
  } catch {
    // Permission errors or missing dir → assume greenfield. The init flow
    // can't proceed in that case anyway; better to fail soft on detection.
    return false;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (IGNORED_NAMES.has(name)) continue;
    return true;
  }
  return false;
}
