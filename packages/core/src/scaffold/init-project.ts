import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PLANNING_DIR = '.swt-planning';

export interface InitProjectOptions {
  /** Absolute project root path. The `.swt-planning/` dir is created here. */
  readonly cwd: string;
  /** Project name. Becomes the H1 of `PROJECT.md` and the `**Project:**` line of `STATE.md`. */
  readonly name: string;
  /** Optional description. When non-empty, replaces the placeholder block in `PROJECT.md`. */
  readonly description?: string;
  /**
   * Source label for the activity-log line in `STATE.md`. Defaults to `'cli'`.
   * The dashboard route passes `'dashboard'` so an audit trail can distinguish
   * who scaffolded the project.
   */
  readonly source?: 'cli' | 'dashboard';
}

export interface InitProjectResult {
  /** Absolute path to the project root (same as `options.cwd`). */
  readonly root: string;
  /** Relative paths (relative to root) of the artifacts that were written or created. */
  readonly files: readonly string[];
}

export class AlreadyInitializedError extends Error {
  override readonly name = 'AlreadyInitializedError';
  readonly planningPath: string;
  constructor(planningPath: string) {
    super(
      `${PLANNING_DIR}/PROJECT.md already exists at ${path.dirname(planningPath)} — the project is already initialized`,
    );
    this.planningPath = planningPath;
  }
}

function projectMd(name: string, description: string | undefined): string {
  const desc = description?.trim() ?? '';
  const descBlock = desc.length > 0 ? `\n\n${desc}\n` : '\n\n_(describe the project here)_\n';
  return `# ${name}${descBlock}\n## Requirements\n\n_(none yet — capture them via \`swt vibe\`)_\n\n## Constraints\n\n_(none yet)_\n`;
}

function stateMd(name: string, source: 'cli' | 'dashboard'): string {
  const initLabel =
    source === 'dashboard' ? 'Initialized via dashboard.' : 'Initialized via swt init.';
  return `# State

**Project:** ${name}
**Milestone:** v0.1 — exploration

## Current Phase

_(none yet — run \`swt vibe\` to scope the first milestone)_

## Activity Log

- ${new Date().toISOString()}: ${initLabel}
`;
}

/**
 * Scaffold a fresh `.swt-planning/` directory with PROJECT.md, STATE.md, and
 * an empty `phases/` subdirectory. Used by both `swt init` (CLI) and
 * `POST /api/init` (dashboard).
 *
 * Throws `AlreadyInitializedError` only if `.swt-planning/PROJECT.md`
 * already exists at `options.cwd` — that is the real "project is
 * initialized" marker. The `.swt-planning/` directory itself can
 * legitimately pre-exist without PROJECT.md (e.g. from a pre-init
 * `POST /api/provider-auth` that ran `mkdir -p .swt-planning/ && writeFile
 * config.json` so the keychain auth block could land before the project
 * was scaffolded). In that case init fills in the missing files alongside
 * the existing config.json. Callers translate the real "already
 * initialized" case to a 409 response or a CLI exit code as appropriate.
 *
 * Filesystem writes are non-atomic — if the process is killed mid-call, the
 * caller may need to clean up partially-written state. The most expensive
 * operation (the second `mkdirSync` for `phases/`) runs after both file
 * writes succeed, so the typical failure mode is "two files written, no
 * `phases/` dir" rather than orphaned partial files.
 */
export function initProject(options: InitProjectOptions): InitProjectResult {
  const planningPath = path.join(options.cwd, PLANNING_DIR);
  const projectPath = path.join(planningPath, 'PROJECT.md');
  // PROJECT.md — not the .swt-planning/ dir itself — is the "project is
  // initialized" marker. The dir can legitimately pre-exist from a
  // pre-init action like a provider-auth save (see the JSDoc above).
  // `mkdirSync(..., {recursive: true})` is a no-op when the dir is
  // already there, so the scaffolding writes proceed safely either way.
  if (existsSync(projectPath)) {
    throw new AlreadyInitializedError(planningPath);
  }
  mkdirSync(planningPath, { recursive: true });
  const statePath = path.join(planningPath, 'STATE.md');
  writeFileSync(projectPath, projectMd(options.name, options.description), 'utf8');
  writeFileSync(statePath, stateMd(options.name, options.source ?? 'cli'), 'utf8');
  mkdirSync(path.join(planningPath, 'phases'), { recursive: true });
  return {
    root: options.cwd,
    files: [
      path.relative(options.cwd, projectPath),
      path.relative(options.cwd, statePath),
      path.relative(options.cwd, path.join(planningPath, 'phases')),
    ],
  };
}
