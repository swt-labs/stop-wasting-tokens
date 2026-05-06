/**
 * Autonomy tier — controls how aggressively the orchestrator advances through
 * the methodology pipeline without prompting the user for confirmation.
 *
 *  - `cautious`:   stop after every stage (Plan, Execute, QA, UAT)
 *  - `standard`:   stop after milestone-level boundaries
 *  - `confident`:  auto-chain phases unless QA fails
 *  - `pure-vibe`:  auto-loop everything; only stop on hard errors
 */
export type Autonomy = 'cautious' | 'standard' | 'confident' | 'pure-vibe';

export const AUTONOMY_TIERS: readonly Autonomy[] = [
  'cautious',
  'standard',
  'confident',
  'pure-vibe',
] as const;

export function isAutonomy(value: unknown): value is Autonomy {
  return typeof value === 'string' && (AUTONOMY_TIERS as readonly string[]).includes(value);
}
