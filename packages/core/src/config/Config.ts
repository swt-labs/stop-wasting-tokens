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

export const ConfigSchema = z.object({
  effort: z.enum(EFFORTS as unknown as [string, ...string[]]).default('balanced'),
  autonomy: z.enum(AUTONOMY_TIERS as unknown as [string, ...string[]]).default('standard'),
  verification_tier: z
    .enum(VERIFICATION_TIERS as unknown as [string, ...string[]])
    .default('standard'),
  model_profile: z.enum(['quality', 'balanced', 'cost']).default('quality'),
  backend: z.enum(['pi']).default('pi'),
  prefer_teams: z.enum(['auto', 'always', 'never']).default('auto'),
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
  planning_tracking: z.enum(['manual', 'ignore', 'commit']).default('manual'),
  auto_push: z.enum(['never', 'after_phase', 'always']).default('never'),
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
});

export type SwtConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: SwtConfig = ConfigSchema.parse({});

export function parseConfig(input: unknown): SwtConfig {
  const result = ConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError('Invalid SWT config', { cause: result.error });
  }
  return result.data;
}
