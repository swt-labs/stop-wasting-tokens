import { z } from 'zod';

/**
 * Budget Gate config + live state (TDD2 §8.4, ADR-007). The Budget Gate
 * triggers tier downgrade at 70% pressure and pauses the milestone at 95%.
 * Implementation lands in M4 PR-35; PR-04 establishes the schemas.
 */

export const BudgetConfigSchema = z.object({
  schema_version: z.literal(1),
  /** Hard ceiling in USD for the whole milestone. */
  milestone_usd: z.number().positive(),
  /** Optional per-phase cap (default = milestone_usd / total_phases). */
  phase_usd: z.number().positive().optional(),
  /** Optional per-task cap. Skipped when undefined. */
  task_usd: z.number().positive().optional(),
  /** Pressure threshold (0..1) that triggers tier downgrade. Default 0.70. */
  tier_downgrade_threshold: z.number().min(0).max(1).default(0.7),
  /** Pressure threshold (0..1) that pauses the milestone. Default 0.95. */
  pause_threshold: z.number().min(0).max(1).default(0.95),
  /** Pre-spawn cost projection toggle. Default on (G-R4). */
  projection_enabled: z.boolean().default(true),
  /**
   * Pressure threshold (0..1) that halts a spawn pre-emptively based on the
   * cost PROJECTION. When undefined, the projection path reuses
   * `pause_threshold`. Lets operators be stricter pre-spawn than post-spawn.
   */
  projection_halt_threshold: z.number().min(0).max(1).optional(),
});

export const BudgetStateSchema = z.object({
  schema_version: z.literal(1),
  milestone_spent_usd: z.number().nonnegative(),
  phase_spent_usd: z.record(z.string(), z.number().nonnegative()),
  task_spent_usd: z.record(z.string(), z.number().nonnegative()),
  /** When the milestone paused (95% threshold hit). Undefined when running. */
  paused_at: z.string().datetime().optional(),
  /** When a tier downgrade was applied (70% threshold hit). */
  tier_downgrade_at: z.string().datetime().optional(),
});

export type BudgetConfigSchemaT = z.infer<typeof BudgetConfigSchema>;
export type BudgetStateSchemaT = z.infer<typeof BudgetStateSchema>;
