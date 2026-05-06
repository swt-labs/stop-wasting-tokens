import { z } from 'zod';

import { ConfigError } from '../errors/SwtError.js';
import { AGENT_ROLES, type AgentRole } from '../types/agent-role.js';
import { AUTONOMY_TIERS } from '../types/autonomy.js';
import { EFFORTS } from '../types/effort.js';
import { VERIFICATION_TIERS } from '../types/verification.js';

const AgentMaxTurnsSchema = z.record(
  z.enum(AGENT_ROLES as unknown as [AgentRole, ...AgentRole[]]),
  z.number().int().positive(),
);

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
  auto_uat: z.boolean().default(false),
  planning_tracking: z.enum(['manual', 'ignore', 'commit']).default('manual'),
  auto_push: z.enum(['never', 'after_phase', 'always']).default('never'),
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
