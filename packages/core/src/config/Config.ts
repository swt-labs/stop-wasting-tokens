import { z } from 'zod';

import { ConfigError } from '../errors/SwtError.js';
import { AGENT_ROLES, type AgentRole } from '../types/index.js';
import { AUTONOMY_TIERS } from '../types/index.js';
import { EFFORTS } from '../types/index.js';
import { VERIFICATION_TIERS } from '../types/index.js';

const AgentRoleEnum = z.enum(AGENT_ROLES as unknown as [AgentRole, ...AgentRole[]]);

const AgentMaxTurnsSchema = z.record(AgentRoleEnum, z.number().int().positive());

const AgentModelOverridesSchema = z.record(AgentRoleEnum, z.string().min(1));

const AgentMcpOverridesSchema = z.record(AgentRoleEnum, z.array(z.string().min(1)));

const HookSubBlockSchema = z
  .object({
    script_path: z.string().min(1),
  })
  .optional();

// Phase 01 settings-v2: shape for entries in `custom_profiles`.
// `values` is `z.unknown()` (loose-at-the-wire); Phase 02 validates each
// custom profile's `values` against `ConfigSchema` at write-time before
// persisting. This avoids forward-referencing `ConfigSchema` from within
// its own object literal and mirrors the `ConfigSnapshot.config: z.unknown()`
// pattern already used at the cross-package wire boundary.
const CustomProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  values: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Dashboard / CLI theme ids. The `default` aesthetic is the original SWT
 * terminal palette (green-on-black); the other seven are widely-recognized
 * developer themes. The list is canonical here in core (rather than in the
 * dashboard package) so the CLI, TUI, and any future surface speak the
 * same theme identifiers — `swt config set theme dracula` works from any
 * entry point and writes a value the dashboard recognises.
 */
export const THEMES = [
  'default',
  'dark',
  'light',
  'solarized',
  'dracula',
  'nord',
  'monokai',
  'gruvbox',
] as const;
export type Theme = (typeof THEMES)[number];

/**
 * `ConfigSchema` — the canonical Zod schema for `.swt-planning/config.json`'s
 * user-preference surface (theme / model / effort / autonomy / settings).
 *
 * **STRIP-UNKNOWN IS INTENTIONAL** (alpha.43 doc clarification — keychain_improvements.md §3.2):
 *
 *   `z.object({...})` defaults to strip-unknown — any top-level key NOT
 *   declared here is silently dropped on `parse()`. This is the correct
 *   shape for the CLI / dashboard preference surface (we don't want stray
 *   fields polluting `SwtConfig`), but it has a load-bearing implication
 *   for any route that writes the parsed result back to disk:
 *
 *   > **Routes that write to `.swt-planning/config.json` MUST NOT write
 *   > the validated `parseConfig()` result verbatim.** Sibling routes own
 *   > top-level keys outside `ConfigSchema` (`auth` and `providers` are
 *   > owned by `provider-auth.ts` / `provider-auth-oauth.ts` and live in
 *   > the same file). A verbatim write strips them and breaks credential
 *   > persistence — the alpha.38 root cause (closed by commit `5f27690`).
 *
 *   The discipline is enforced structurally via
 *   `packages/dashboard/src/server/lib/update-config-file.ts` (alpha.40)
 *   — a shared read-modify-write helper that preserves every top-level
 *   key the caller's mutator doesn't touch. The
 *   `update-config-file.test.ts` invariant suite locks this in for all
 *   current + future config-writing routes.
 *
 *   `config.test.ts` has an explicit assertion that `ConfigSchema.parse`
 *   strips unknown top-level keys, so the silent-contract is no longer
 *   silent.
 */
export const ConfigSchema = z.object({
  effort: z.enum(EFFORTS as unknown as [string, ...string[]]).default('balanced'),
  autonomy: z.enum(AUTONOMY_TIERS as unknown as [string, ...string[]]).default('standard'),
  verification_tier: z
    .enum(VERIFICATION_TIERS as unknown as [string, ...string[]])
    .default('standard'),
  qa_skip_agents: z.array(z.string()).default(['docs']),
  // `max_uat_remediation_rounds`: false = unlimited rounds; positive integer = hard cap.
  // Consumers must handle both branches of the union.
  max_uat_remediation_rounds: z
    .union([z.number().int().positive(), z.literal(false)])
    .default(false),
  caveman_style: z.enum(['none', 'aggressive', 'extreme']).default('none'),
  model_profile: z.enum(['quality', 'balanced', 'cost']).default('quality'),
  /**
   * User-selected model id (e.g., 'claude-opus-4-5', 'gpt-4o', 'deepseek-chat').
   * When non-null, takes priority over `model_profile` resolution for
   * spawn callsites — the dashboard's TopBar Model dropdown writes here
   * on user selection. When null (default), the existing `model_profile`
   * → per-role resolution applies. Open string by design (matches the
   * `active_profile` pattern): Pi's ModelRegistry is the source of truth
   * for valid ids; the schema accepts any string so the dashboard doesn't
   * have to mirror Pi's full registry into a Zod enum.
   */
  model: z.union([z.string().min(1), z.null()]).default(null),
  skill_suggestions: z.boolean().default(true),
  auto_install_skills: z.boolean().default(false),
  visual_format: z.enum(['unicode', 'ascii']).default('unicode'),
  backend: z.enum(['pi']).default('pi'),
  prefer_teams: z.enum(['auto', 'always', 'never']).default('auto'),
  discovery_questions: z.boolean().default(true),
  discussion_mode: z.enum(['questions', 'assumptions', 'auto']).default('questions'),
  require_phase_discussion: z.boolean().default(false),
  context_compiler: z.boolean().default(true),
  rolling_summary: z.boolean().default(false),
  worktree_isolation: z.enum(['off', 'on', 'auto']).default('off'),
  agent_max_turns: AgentMaxTurnsSchema.default({
    scout: 15,
    qa: 25,
    architect: 30,
    debugger: 80,
    lead: 50,
    dev: 75,
  }),
  model_overrides: AgentModelOverridesSchema.default({}),
  mcp_overrides: AgentMcpOverridesSchema.default({}),
  auto_uat: z.boolean().default(false),
  auto_commit: z.boolean().default(true),
  planning_tracking: z.enum(['manual', 'ignore', 'commit']).default('manual'),
  auto_push: z.enum(['never', 'after_phase', 'always']).default('never'),
  branch_per_milestone: z.boolean().default(false),
  max_tasks_per_plan: z.number().int().positive().default(5),
  telemetry: z
    .object({
      enabled: z.boolean().default(false),
      anonymous_id: z.string().uuid().optional(),
      opted_in_at: z.string().optional(),
      endpoint: z.string().url().optional(),
      cache_ttl_hours: z.number().int().positive().default(24),
    })
    .default({ enabled: false }),
  marketplace: z
    .object({
      endpoint: z.string().url().optional(),
      cache_ttl_hours: z.number().int().positive().default(24),
    })
    .optional(),
  hooks: z
    .object({
      session_start: HookSubBlockSchema,
      user_prompt_submit: HookSubBlockSchema,
      pre_tool_use: HookSubBlockSchema,
      post_tool_use: HookSubBlockSchema,
      permission_request: HookSubBlockSchema,
      stop: HookSubBlockSchema,
      pre_archive: HookSubBlockSchema,
      post_phase: HookSubBlockSchema,
      pre_phase: HookSubBlockSchema,
      post_uat_fail: HookSubBlockSchema,
      pre_qa: HookSubBlockSchema,
      post_qa: HookSubBlockSchema,
    })
    .optional(),
  // `active_profile` is an open string (not `z.enum(...)`) so users can save
  // a custom profile id from `custom_profiles` as the active one. Strict
  // narrowing to the builtin set happens at the Phase 02 ProfileDropdown UI
  // boundary via the `ProfileId` TS type derived from `BUILTIN_PROFILES`.
  active_profile: z.string().default('default'),
  custom_profiles: z.record(z.string(), CustomProfileSchema).default({}),
  /**
   * Dashboard / CLI theme. Defaults to `'default'` (the original SWT
   * terminal green-on-black palette). Existing `.swt-planning/config.json`
   * files without this field parse cleanly thanks to `.default(...)`;
   * `parseConfig({})` produces `theme: 'default'`.
   */
  theme: z.enum(THEMES).default('default'),
});

export { CustomProfileSchema };

export type SwtConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: SwtConfig = ConfigSchema.parse({});

export function parseConfig(input: unknown): SwtConfig {
  const result = ConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError('Invalid SWT config', { cause: result.error });
  }
  return result.data;
}
