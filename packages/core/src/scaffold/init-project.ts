import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Plan 01-01 T01 (milestone 23, Phase 01): the function now also writes
 * REQUIREMENTS.md, ROADMAP.md, and config.json. The git-init / detect-stack
 * / bootstrap-claude / install-hooks / sync-gitignore wiring lands in T02
 * — for T01 the new `brownfield`, `gitInitialized`, `stack` result fields
 * are stubbed (`false`, `false`, `[]`).
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
  mkdirSync(planningPath, { recursive: true });

  const pluginRoot = resolvePluginRootForInit(options.pluginRoot);

  // 1. PROJECT.md + STATE.md (existing behavior).
  const statePath = path.join(planningPath, 'STATE.md');
  writeFileSync(projectPath, projectMd(options.name, options.description), 'utf8');
  writeFileSync(statePath, stateMd(options.name, options.source ?? 'cli'), 'utf8');

  // 2. REQUIREMENTS.md from the shipped template, with `{Project Name}` +
  //    `{date}` + `{one-liner}` substituted from the caller's data.
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

  // 3. ROADMAP.md from the shipped template, with `{Project Name}` +
  //    `{overview-sentence}` substituted from the caller's data.
  const roadmapTemplatePath = path.join(pluginRoot, 'templates', 'ROADMAP.md');
  const roadmapTemplate = readFileSync(roadmapTemplatePath, 'utf8');
  const roadmapContent = substituteTemplate(roadmapTemplate, {
    'Project Name': options.name,
    'overview-sentence': options.description?.trim() ?? '',
  });
  const roadmapPath = path.join(planningPath, 'ROADMAP.md');
  writeFileSync(roadmapPath, roadmapContent, 'utf8');

  // 4. config.json from defaults.json + the caller's planning_tracking +
  //    auto_push overrides. Deep-merges any pre-existing config.json (e.g.
  //    from a pre-init provider-auth save) so auth/providers keys survive.
  const configPath = writeConfigJson({
    cwd: options.cwd,
    pluginRoot,
    ...(options.planningTracking !== undefined
      ? { planningTracking: options.planningTracking }
      : {}),
    ...(options.autoPush !== undefined ? { autoPush: options.autoPush } : {}),
  });

  // 5. Empty phases/ directory (existing behavior).
  const phasesPath = path.join(planningPath, 'phases');
  mkdirSync(phasesPath, { recursive: true });

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
    // Milestone 23 T01 stubs — T02 wires the real values.
    brownfield: false,
    gitInitialized: false,
    stack: [],
  };
}
