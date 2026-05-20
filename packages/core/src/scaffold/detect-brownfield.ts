/**
 * `detectBrownfield` — TypeScript port of the `commands/init.md` Guard
 * step 3 heuristic. Counts user source files under `cwd` excluding
 * SWT/build/dependency directories, returns `{brownfield, sourceFileCount}`.
 *
 * Plan 23-01-01 T02 (milestone 23, Phase 01). Used by `initProject()` (T02)
 * AND by `GET /api/init-precheck` (T03), so the helper is read-only,
 * synchronous, and never mutates the project directory.
 *
 * The whitelist of source-file extensions matches `scripts/detect-stack.sh`
 * line of business (TypeScript, Python, Rust, Go, Java, Ruby, Swift,
 * Kotlin, C/C++, C#, Scala, Elixir, Erlang, etc.). Anything outside the
 * whitelist is ignored — so a brand-new repo containing only `.md` /
 * `.json` / `.gitignore` does NOT trip the heuristic.
 *
 * Bounded recursion depth: 6 levels. Mirrors the Guard's "depth-3 with
 * subdir manifests" but more permissive — most monorepos nest 4-5 levels
 * (e.g. `packages/foo/src/components/Button.tsx`). The exclusion list
 * cuts off `node_modules/`, `.git/`, `.swt-planning/`, `dist/`, `build/`,
 * `target/`, `vendor/`, `__pycache__/`, `.next/`, `.venv/`.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set([
  // JS / TS
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  // Python
  '.py',
  // Rust
  '.rs',
  // Go
  '.go',
  // Java / Kotlin / Scala
  '.java',
  '.kt',
  '.kts',
  '.scala',
  // Ruby
  '.rb',
  // PHP
  '.php',
  // Swift
  '.swift',
  // C-family
  '.c',
  '.h',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.cc',
  // C#
  '.cs',
  // BEAM
  '.ex',
  '.exs',
  '.erl',
  // Dart
  '.dart',
  // Elm / OCaml / Haskell
  '.elm',
  '.ml',
  '.mli',
  '.hs',
  // Shell / SQL — count as source for brownfield detection (a `.sh`-only
  // project is still a project).
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
]);

const EXCLUDED_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  '.swt-planning',
  '.vbw-planning',
  'node_modules',
  '.pnpm-store',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '__pycache__',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.cache',
  'coverage',
  '.nyc_output',
  '.idea',
  '.vscode',
  '.gradle',
  '.cargo',
  'tmp',
]);

const MAX_DEPTH = 6;

export interface DetectBrownfieldResult {
  /** `true` iff at least one source file was found outside excluded dirs. */
  readonly brownfield: boolean;
  /** Count of source files matching the extension whitelist. */
  readonly sourceFileCount: number;
}

function isSourceFile(name: string): boolean {
  // path.extname returns the LAST `.`-prefixed suffix; lowercased for the
  // set lookup so `.TS` / `.PY` count.
  return SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function countSourceFiles(dir: string, depth: number): number {
  if (depth > MAX_DEPTH) return 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Permission denied / I/O error — skip silently.
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      count += countSourceFiles(path.join(dir, entry.name), depth + 1);
    } else if (entry.isFile()) {
      if (isSourceFile(entry.name)) count += 1;
    } else if (entry.isSymbolicLink()) {
      // Resolve the symlink and check what it points to.
      try {
        const target = path.join(dir, entry.name);
        const s = statSync(target);
        if (s.isFile() && isSourceFile(entry.name)) count += 1;
        // Do NOT recurse into symlinked dirs — risk of cycles.
      } catch {
        // Broken symlink — skip.
      }
    }
  }
  return count;
}

/**
 * Walk `cwd` (bounded depth) and count user source files. Returns
 * `{brownfield: count > 0, sourceFileCount: count}`.
 */
export function detectBrownfield(cwd: string): DetectBrownfieldResult {
  const count = countSourceFiles(cwd, 0);
  return { brownfield: count > 0, sourceFileCount: count };
}
