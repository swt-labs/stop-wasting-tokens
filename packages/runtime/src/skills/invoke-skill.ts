/**
 * Plan 01-04 (Phase 1) — Pi-substrate primitive 4: `swt:invokeSkill`.
 *
 * Synchronous SKILL.md file reader. Given a skill name, resolves a SKILL.md
 * path with two-tier precedence and returns the file's raw contents as a
 * string. The orchestrator inlines the result into the agent's prompt as the
 * `<skill_activation>` block defined in `references/discussion-engine.md` and
 * the per-agent prompt bodies — REQ-06.
 *
 *   Tier 1 (user-installed, wins on conflict):
 *     `${userSkillsDir ?? ~/.swt/skills}/${skillName}/SKILL.md`
 *
 *   Tier 2 (bundled fallback):
 *     `${installRoot ?? resolveInstallRoot()}/skills/${skillName}/SKILL.md`
 *
 * The two-tier order mirrors VBW's `~/.claude/plugins/skills/{name}/SKILL.md`
 * vs bundled-skill precedence (research §3 primitive 4). User-installed
 * skills always win so a user can override a bundled skill in-place without
 * touching the SWT install.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  WHERE THE BRIDGE TO Pi HAPPENS — Pi custom-tool registration         ║
 * ║  boundary (READ THIS BEFORE EXTENDING THIS MODULE)                    ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 *   This module exposes the *raw* SKILL.md reader only. It DOES NOT register
 *   the `swt_invoke_skill` Pi custom tool on any agent session. That bridge
 *   is intentionally separate and lives in `swt:spawnAgent` (plan 01-01,
 *   `packages/orchestration/src/spawn-agent.ts`).
 *
 *   Bridge pattern (locked in plan 01-01 + Phase 3's full custom-tool table)
 *   — registration is conditional on whether the role's tool allowlist
 *   includes `Skill`:
 *
 *     // Inside spawnAgent's session construction, AFTER `toolsForRole(...)`
 *     // has returned the role's Pi tool bundle:
 *     const customTools = [];
 *     if (roleAllowsSkill(role, spec)) {
 *       customTools.push({
 *         name: 'swt_invoke_skill',
 *         description: 'Read a SKILL.md from the installed skills directory',
 *         parameters: { name: { type: 'string' } },
 *         async execute({ name }) {
 *           return { content: invokeSkill(name) };
 *         },
 *       });
 *     }
 *     return createAgentSession({ ..., customTools });
 *
 *   Source-of-truth for the per-role `Skill` allowlist:
 *     - `agents/swt-architect.md` → `tools: Read, Glob, Grep, Write, LSP, Skill`
 *     - `agents/swt-lead.md`      → `tools: ..., Skill, Task(swt-dev)`
 *     - `agents/swt-docs.md`      → `tools: Read, Grep, Glob, Bash, Write, Edit, LSP, Skill`
 *     - `agents/swt-dev.md`       → denylist; `Skill` is permitted by omission
 *     - `agents/swt-qa.md`        → denylist; `Skill` is permitted by omission
 *     - `agents/swt-scout.md`     → denylist; `Skill` is permitted by omission
 *     - `agents/swt-debugger.md`  → denylist; `Skill` is permitted by omission
 *
 *   Roles whose frontmatter denylists `Skill` (or whose allowlist omits it)
 *   MUST NOT have `swt_invoke_skill` registered — gatekeeping is enforced
 *   ONE LAYER UP in `role-router.ts` + `spawnAgent`, not here. This module
 *   stays a pure file-system primitive and is unit-tested without a Pi
 *   session.
 *
 *   See research §3 primitive 4 for the full contract. Cross-plan link:
 *   plan 01-01 owns the spawnAgent wiring; this file is plan 01-04's
 *   primitive 4 export.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveInstallRoot } from '../env.js';

/**
 * Skill-name shape guard. Skills are kebab-case slugs (`tailwind-css-patterns`,
 * `rust-best-practices`, etc.) plus an optional digit. Anything else — slashes,
 * `..`, leading dots, whitespace, empty strings — is rejected before any fs
 * access to prevent path traversal. Matches the convention enforced by the
 * `scripts/extract-skill-follow-up-files.sh` parser.
 */
const VALID_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Options accepted by both `resolveSkillPath` and `invokeSkill`. Both
 * overrides are primarily for tests; production code calls without args and
 * accepts the resolveInstallRoot + ~/.swt/skills defaults.
 */
export interface InvokeSkillOptions {
  /**
   * Override the user-installed skills directory. Defaults to
   * `${homedir()}/.swt/skills`.
   */
  userSkillsDir?: string;
  /**
   * Override the install root used for the bundled-skill fallback. Defaults
   * to `resolveInstallRoot()`.
   */
  installRoot?: string;
}

function assertValidSkillName(skillName: unknown): asserts skillName is string {
  if (typeof skillName !== 'string') {
    throw new Error(`swt:invokeSkill — skill name must be a string, got ${typeof skillName}.`);
  }
  const trimmed = skillName.trim();
  if (trimmed.length === 0) {
    throw new Error('swt:invokeSkill — skill name must not be empty or whitespace.');
  }
  if (!VALID_SKILL_NAME.test(skillName)) {
    throw new Error(
      `swt:invokeSkill — invalid skill name "${skillName}". ` +
        `Expected kebab-case matching ${VALID_SKILL_NAME.toString()} ` +
        `(no slashes, dots, or path-traversal sequences).`,
    );
  }
}

function userSkillsDirFor(opts: InvokeSkillOptions): string {
  return opts.userSkillsDir ?? join(homedir(), '.swt', 'skills');
}

function installSkillsDirFor(opts: InvokeSkillOptions): string {
  const root = opts.installRoot ?? resolveInstallRoot();
  return join(root, 'skills');
}

/**
 * Resolve a skill name to an absolute SKILL.md path, applying the two-tier
 * precedence (user-installed wins). Returns `null` if neither tier resolves
 * to an existing file.
 *
 * Validates `skillName` against the path-traversal guard before any fs
 * access — invalid names throw synchronously.
 */
export function resolveSkillPath(skillName: string, opts: InvokeSkillOptions = {}): string | null {
  assertValidSkillName(skillName);

  const userPath = join(userSkillsDirFor(opts), skillName, 'SKILL.md');
  if (existsSync(userPath)) return userPath;

  const bundledPath = join(installSkillsDirFor(opts), skillName, 'SKILL.md');
  if (existsSync(bundledPath)) return bundledPath;

  return null;
}

/**
 * Synchronously read the SKILL.md content for the given skill name. Returns
 * the raw file contents as a UTF-8 string — the orchestrator is responsible
 * for parsing frontmatter and inlining the body into a `<skill_activation>`
 * block.
 *
 * Throws when the skill name is invalid or when neither the user-installed
 * nor the bundled-skill path resolves. The thrown Error message contains
 * both attempted paths so the operator can debug installation problems
 * without re-running with extra logging.
 */
export function invokeSkill(skillName: string, opts: InvokeSkillOptions = {}): string {
  assertValidSkillName(skillName);

  const userPath = join(userSkillsDirFor(opts), skillName, 'SKILL.md');
  const bundledPath = join(installSkillsDirFor(opts), skillName, 'SKILL.md');

  const resolved = existsSync(userPath) ? userPath : existsSync(bundledPath) ? bundledPath : null;

  if (resolved === null) {
    throw new Error(
      `swt:invokeSkill — skill not found: "${skillName}". ` +
        `Tried: ${userPath}, ${bundledPath}. ` +
        `Install via the SWT skills directory or bundle it under the install root.`,
    );
  }

  return readFileSync(resolved, 'utf8');
}
