import { z } from 'zod';

import { ConfigError } from '../errors/SwtError.js';
import { AGENT_ROLES, type AgentRole } from '../types/agent-role.js';
import { AUTONOMY_TIERS } from '../types/autonomy.js';
import { EFFORTS } from '../types/effort.js';
import { VERIFICATION_TIERS } from '../types/verification.js';

const AgentRoleEnum = z.enum(AGENT_ROLES as unknown as [AgentRole, ...AgentRole[]]);

const AgentMaxTurnsSchema = z.record(AgentRoleEnum, z.number().int().positive());

const AgentModelOverridesSchema = z.record(AgentRoleEnum, z.string().min(1));

const AgentMcpOverridesSchema = z.record(AgentRoleEnum, z.array(z.string().min(1)));

export const ConfigSchema = z.object({
  effort: z.enum(EFFORTS as unknown as [string, ...string[]]).default('balanced'),
  autonomy: z
    .enum(AUTONOMY_TIERS as unknown as [string, ...string[]])
    .default('standard'),
  verification_tier: z
    .enum(VERIFICATION_TIERS as unknown as [string, ...string[]])
    .default('standard'),
  model_profile: z.enum(['quality', 'balanced', 'cost']).default('quality'),
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
    })
    .default({ enabled: false }),
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
