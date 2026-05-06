import {
  EFFORT_TURN_SCALAR,
  type Effort,
  type AgentRole,
} from '@swt-labs/core';

export interface EffortProfile {
  /** Whether to spawn the Scout for research before planning. */
  readonly include_scout: boolean;
  /** Whether to spawn the Architect for design before planning. */
  readonly include_architect: boolean;
  /** Whether to run QA after Execute. */
  readonly include_qa: boolean;
  /** Maximum tasks per plan. */
  readonly max_tasks_per_plan: number;
  /** Token-budget scaling factor applied per agent. */
  readonly turn_scalar: number;
}

export const EFFORT_PROFILES: Readonly<Record<Effort, EffortProfile>> = {
  thorough: {
    include_scout: true,
    include_architect: true,
    include_qa: true,
    max_tasks_per_plan: 8,
    turn_scalar: EFFORT_TURN_SCALAR.thorough,
  },
  balanced: {
    include_scout: true,
    include_architect: false,
    include_qa: true,
    max_tasks_per_plan: 5,
    turn_scalar: EFFORT_TURN_SCALAR.balanced,
  },
  fast: {
    include_scout: false,
    include_architect: false,
    include_qa: true,
    max_tasks_per_plan: 5,
    turn_scalar: EFFORT_TURN_SCALAR.fast,
  },
  turbo: {
    include_scout: false,
    include_architect: false,
    include_qa: false,
    max_tasks_per_plan: 3,
    turn_scalar: EFFORT_TURN_SCALAR.turbo,
  },
};

export function resolveEffortProfile(effort: Effort): EffortProfile {
  return EFFORT_PROFILES[effort];
}

export function scaleAgentTurns(
  base: Readonly<Record<AgentRole, number>>,
  effort: Effort,
): Readonly<Record<AgentRole, number>> {
  const scalar = EFFORT_TURN_SCALAR[effort];
  const out: Partial<Record<AgentRole, number>> = {};
  for (const [role, turns] of Object.entries(base)) {
    out[role as AgentRole] = Math.max(1, Math.round(turns * scalar));
  }
  return out as Readonly<Record<AgentRole, number>>;
}
