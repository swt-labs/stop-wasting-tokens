/**
 * Effort tier — controls planning depth, verification thoroughness, and the
 * agent turn budget scalar applied at spawn time.
 *
 * Tier scalars (applied to `agent_max_turns` per agent):
 *  - `thorough`: 1.5× — maximum planning and verification depth
 *  - `balanced`: 1.0× — production default
 *  - `fast`:     0.8× — quick iteration; skip optional verification gates
 *  - `turbo`:    0.6× — single-shot execution; skip Lead/Scout where safe
 */
export type Effort = 'thorough' | 'balanced' | 'fast' | 'turbo';

export const EFFORTS: readonly Effort[] = ['thorough', 'balanced', 'fast', 'turbo'] as const;

export const EFFORT_TURN_SCALAR: Readonly<Record<Effort, number>> = {
  thorough: 1.5,
  balanced: 1.0,
  fast: 0.8,
  turbo: 0.6,
};

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}
