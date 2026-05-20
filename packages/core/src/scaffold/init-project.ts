import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapClaudeMd } from './bootstrap-claude-md.js';
import { detectBrownfield } from './detect-brownfield.js';
import { initGit } from './init-git.js';
import { installGitHooks } from './install-git-hooks.js';
import { runDetectStack } from './run-detect-stack.js';
import { syncGitignore } from './sync-gitignore.js';
import { writeConfigJson } from './write-config-json.js';

const PLANNING_DIR = '.swt-planning';
const PACKAGE_NAME = 'stop-wasting-tokens';

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
  /**
   * Milestone-23 — planning-tracking mode the wizard collected in Step 2.
   * Persisted into `.swt-planning/config.json` under the `planning_tracking`
   * key. When omitted, the default from `config/defaults.json` (`'manual'`)
   * is preserved.
   */
  readonly planningTracking?: 'manual' | 'ignore' | 'commit';
  /**
   * Milestone-23 — auto-push mode the wizard collected in Step 2. Persisted
   * into `.swt-planning/config.json` under the `auto_push` key. When omitted,
   * the default (`'never'`) is preserved.
   */
  readonly autoPush?: 'never' | 'after_phase' | 'always';
  /**
   * Milestone-23 — whether to attempt `git init` when no `.git` is present
   * in the cwd or any parent. T01 only stubs this field; T02 wires it
   * through to the `initGit()` helper. Default `true` (silent auto-init).
   */
  readonly initGit?: boolean;
  /**
   * Milestone-23 — plugin root override. When provided, the helper reads
   * `${pluginRoot}/templates/REQUIREMENTS.md`, `${pluginRoot}/templates/
   * ROADMAP.md`, and `${pluginRoot}/config/defaults.json` directly. When
   * omitted, the helper walks up from `import.meta.url`. Useful for tests
   * and for non-standard tarball layouts. NO provider-related fields are
   * carried here (Locked Decision #10 — init is vendor-agnostic).
   */
  readonly pluginRoot?: string;
}

export interface InitProjectResult {
  /** Absolute path to the project root (same as `options.cwd`). */
  readonly root: string;
  /** Relative paths (relative to root) of the artifacts that were written or created. */
  readonly files: readonly string[];
  /**
   * Milestone-23 — whether the cwd contains user source code outside
   * `.swt-planning/`, `.git/`, `node_modules/`, etc. T01 stubs this `false`
   * unconditionally; T02 wires the real `detectBrownfield()` heuristic.
   */
  readonly brownfield: boolean;
  /**
   * Milestone-23 — `true` only when THIS call ran `git init`. `false` when
   * a `.git` already existed in cwd OR any parent. T01 stubs `false`; T02
   * wires the real detection.
   */
  readonly gitInitialized: boolean;
  /**
   * Milestone-23 — detected stack tags from `scripts/detect-stack.sh` (e.g.
   * `['typescript', 'react']`). Empty `[]` for greenfield projects and for
   * T01 (stubbed). T02 runs detect-stack.sh for brownfield only.
   */
  readonly stack: readonly string[];
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

function walkUpForPluginRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    const pkgPath = `${current}${sep}package.json`;
    if (existsSync(pkgPath)) {
      try {
        const raw = readFileSync(pkgPath, 'utf8');
        const parsed = JSON.parse(raw) as { name?: unknown };
        if (typeof parsed.name === 'string' && parsed.name === PACKAGE_NAME) {
          return current;
        }
      } catch {
        // Unreadable / invalid JSON — keep walking.
      }
    }
    const scriptsGuard = `${current}${sep}scripts${sep}bash-guard.sh`;
    if (existsSync(scriptsGuard)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolve the plugin root (the tarball-shipped directory containing
 * `templates/`, `config/`, `scripts/`, etc.). Honored in this priority:
 *   1. Explicit `options.pluginRoot` override.
 *   2. `process.env.SWT_INSTALL_ROOT` (set by the runtime bootstrap).
 *   3. Walk up from `import.meta.url`.
 *
 * Throws when none resolves so the operator can surface the issue early.
 * Internal — exported for tests only.
 */
export function resolvePluginRootForInit(override: string | undefined): string {
  if (typeof override === 'string' && override.length > 0) return override;
  const envOverride = process.env.SWT_INSTALL_ROOT;
  if (typeof envOverride === 'string' && envOverride.length > 0) return envOverride;
  let here: string;
  try {
    here = fileURLToPath(import.meta.url);
  } catch (err) {
    throw new Error(
      `initProject: unable to resolve plugin root from import.meta.url (${
        err instanceof Error ? err.message : String(err)
      }). Pass options.pluginRoot explicitly or set SWT_INSTALL_ROOT.`,
    );
  }
  const resolved = walkUpForPluginRoot(dirname(here));
  if (resolved === null) {
    throw new Error(
      `initProject: could not locate the SWT plugin root by walking up from ${here}. ` +
        `Expected to find package.json with name="${PACKAGE_NAME}" or a sibling scripts/bash-guard.sh. ` +
        `Pass options.pluginRoot explicitly or set SWT_INSTALL_ROOT.`,
    );
  }
  return resolved;
}

function substituteTemplate(
  template: string,
  substitutions: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(substitutions)) {
    // Use a literal `{key}` token replacement. Templates use single-brace
    // placeholders (verified against templates/REQUIREMENTS.md +
    // templates/ROADMAP.md). Keep replacement narrow — only substitute
    // tokens the caller explicitly asks for; other `{placeholders}` in the
    // template stay intact (they are user-fillable scaffolding hints).
    const needle = `{${key}}`;
    // Replace all occurrences without regex (placeholders can contain
    // chars that would otherwise need escaping).
    out = out.split(needle).join(value);
  }
  return out;
}

/**
 * Scaffold a fresh `.swt-planning/` directory with all 6 planning artifacts:
 * `PROJECT.md`, `STATE.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `config.json`,
 * and `phases/`. Used by both `swt init` (CLI) and `POST /api/init`
 * (dashboard).
 *
 * Throws `AlreadyInitializedError` only if `.swt-planning/PROJECT.md`
 * already exists at `options.cwd` — that is the real "project is
 * initialized" marker. The `.swt-planning/` directory itself can
 * legitimately pre-exist without PROJECT.md (e.g. from a pre-init
 * `POST /api/provider-auth` that ran `mkdir -p .swt-planning/ && writeFile
 * config.json` so the keychain auth block could land before the project
 * was scaffolded). In that case init fills in the missing files alongside
 * the existing config.json (and the new `config.json` write deep-merges so
 * the pre-existing keys survive).
 *
 * Filesystem writes are non-atomic — if the process is killed mid-call,
 * the caller may need to clean up partially-written state.
 *
 * Plan 23-01-01 T01 + T02 (milestone 23, Phase 01): the function now writes
 * all 6 planning artifacts AND orchestrates `git init` + brownfield detection
 * + detect-stack + bootstrap-claude + install-hooks + sync-gitignore in the
 * exact order required for the synchronous wizard scaffold.
 *
 * Orchestration order (AC 12-17):
 *   1. AlreadyInitializedError guard.
 *   2. detectBrownfield(cwd) → sets `result.brownfield`.
 *   3. initGit(cwd) if opts.initGit !== false. If alreadyExists === 'parent',
 *      append a STATE.md activity-log line "Working inside parent repo at ..."
 *      (AC 13).
 *   4. mkdir .swt-planning/ + write PROJECT.md + STATE.md + phases/.
 *   5. Write REQUIREMENTS.md + ROADMAP.md from templates.
 *   6. writeConfigJson(cwd, planningTracking, autoPush).
 *   7. syncGitignore(cwd, pluginRoot) — AC 14.
 *   8. If result.brownfield → runDetectStack(cwd, pluginRoot) → result.stack
 *      (AC 16; greenfield skips this call entirely).
 *   9. bootstrapClaudeMd(cwd, pluginRoot, name, coreValue) — AC 17 (preserves
 *      user content when a CLAUDE.md already exists).
 *  10. installGitHooks(cwd, pluginRoot) — AC 15 (safe because step 3
 *      guarantees a git repo).
 *  11. If opts.planningTracking === 'commit' → planning-git.sh commit-boundary
 *      'init' to atomically commit the new planning files.
 */
export function initProject(options: InitProjectOptions): InitProjectResult {
  const planningPath = path.join(options.cwd, PLANNING_DIR);
  const projectPath = path.join(planningPath, 'PROJECT.md');
  // PROJECT.md — not the .swt-planning/ dir itself — is the "project is
  // initialized" marker. The dir can legitimately pre-exist from a
  // pre-init action like a provider-auth save (see the JSDoc above).
  if (existsSync(projectPath)) {
    throw new AlreadyInitializedError(planningPath);
  }

  const pluginRoot = resolvePluginRootForInit(options.pluginRoot);

  // 1. Brownfield detection — must run BEFORE writing anything to
  //    .swt-planning/ so the heuristic sees the actual project state.
  const { brownfield } = detectBrownfield(options.cwd);

  // 2. Git init — silent + automatic when no .git exists in cwd OR any
  //    parent. Skipped when one already exists.
  let gitInitialized = false;
  let parentRepoPath = '';
  if (options.initGit !== false) {
    const gitResult = initGit(options.cwd);
    gitInitialized = gitResult.initialized;
    parentRepoPath = gitResult.parentRepoPath;
  }

  // 3. PROJECT.md + STATE.md + phases/.
  mkdirSync(planningPath, { recursive: true });
  const statePath = path.join(planningPath, 'STATE.md');
  writeFileSync(projectPath, projectMd(options.name, options.description), 'utf8');
  writeFileSync(statePath, stateMd(options.name, options.source ?? 'cli'), 'utf8');
  // Parent-repo activity-log line (AC 13).
  if (parentRepoPath.length > 0) {
    appendFileSync(
      statePath,
      `- ${new Date().toISOString()}: Working inside parent repo at ${parentRepoPath}\n`,
      'utf8',
    );
  }

  // 4. REQUIREMENTS.md from the shipped template.
  const requirementsTemplatePath = path.join(pluginRoot, 'templates', 'REQUIREMENTS.md');
  const requirementsTemplate = readFileSync(requirementsTemplatePath, 'utf8');
  const isoDate = new Date().toISOString().slice(0, 10);
  const requirementsContent = substituteTemplate(requirementsTemplate, {
    'Project Name': options.name,
    date: isoDate,
    'one-liner': options.description?.trim() ?? '',
  });
  const requirementsPath = path.join(planningPath, 'REQUIREMENTS.md');
  writeFileSync(requirementsPath, requirementsContent, 'utf8');

  // 5. ROADMAP.md from the shipped template.
  const roadmapTemplatePath = path.join(pluginRoot, 'templates', 'ROADMAP.md');
  const roadmapTemplate = readFileSync(roadmapTemplatePath, 'utf8');
  const roadmapContent = substituteTemplate(roadmapTemplate, {
    'Project Name': options.name,
    'overview-sentence': options.description?.trim() ?? '',
  });
  const roadmapPath = path.join(planningPath, 'ROADMAP.md');
  writeFileSync(roadmapPath, roadmapContent, 'utf8');

  // 6. config.json from defaults.json + caller overrides (deep-merge).
  const configPath = writeConfigJson({
    cwd: options.cwd,
    pluginRoot,
    ...(options.planningTracking !== undefined
      ? { planningTracking: options.planningTracking }
      : {}),
    ...(options.autoPush !== undefined ? { autoPush: options.autoPush } : {}),
  });

  // 7. Empty phases/ directory.
  const phasesPath = path.join(planningPath, 'phases');
  mkdirSync(phasesPath, { recursive: true });

  // 8. .gitignore sync (AC 14) — idempotent + safe outside git repos.
  syncGitignore(options.cwd, pluginRoot);

  // 9. Stack detection for brownfield projects only (AC 16). Greenfield
  //    skips this call entirely → stack remains [].
  let stack: readonly string[] = [];
  if (brownfield) {
    stack = runDetectStack(options.cwd, pluginRoot);
  }

  // 10. CLAUDE.md bootstrap (AC 17) — preserves user content when a
  //     CLAUDE.md already exists. bootstrap-claude.sh rejects an empty
  //     CORE_VALUE, so fall back to a generic one-liner derived from the
  //     project name when the wizard's description field was left blank.
  //     Phase 02's wizard always collects a description in Step 1, but the
  //     CLI path + tests can legitimately call without one.
  const trimmedDescription = options.description?.trim() ?? '';
  const coreValue =
    trimmedDescription.length > 0 ? trimmedDescription : `${options.name} — initialized via SWT`;
  bootstrapClaudeMd(options.cwd, pluginRoot, options.name, coreValue);

  // 11. Install git hooks (AC 15) — safe because step 2 guarantees a git
  //     repo. Script also exits 0 silently when no repo exists, so this is
  //     a no-op in the rare parent-repo branch where initGit skipped.
  installGitHooks(options.cwd, pluginRoot);

  // 12. If planning_tracking === 'commit', stage + commit the new planning
  //     files atomically via planning-git.sh commit-boundary.
  if (options.planningTracking === 'commit') {
    try {
      const planningGitScript = path.join(pluginRoot, 'scripts', 'planning-git.sh');
      execFileSync('bash', [planningGitScript, 'commit-boundary', 'init', configPath], {
        cwd: options.cwd,
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch {
      // commit-boundary is best-effort — a failure here (e.g. no git
      // identity configured, hooks rejecting the commit) must not break
      // the synchronous scaffold's success contract. The user can rerun
      // `git add . && git commit` manually if needed.
    }
  }

  return {
    root: options.cwd,
    files: [
      path.relative(options.cwd, projectPath),
      path.relative(options.cwd, statePath),
      path.relative(options.cwd, requirementsPath),
      path.relative(options.cwd, roadmapPath),
      path.relative(options.cwd, configPath),
      path.relative(options.cwd, phasesPath),
    ],
    brownfield,
    gitInitialized,
    stack,
  };
}
