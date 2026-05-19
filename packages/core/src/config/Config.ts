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
