import type { Autonomy } from '@swt-labs/core';

export interface AutonomyProfile {
  readonly stop_after_plan: boolean;
  readonly stop_after_execute: boolean;
  readonly stop_after_qa: boolean;
  readonly auto_chain_phases: boolean;
}

export const AUTONOMY_PROFILES: Readonly<Record<Autonomy, AutonomyProfile>> = {
  cautious: {
    stop_after_plan: true,
    stop_after_execute: true,
    stop_after_qa: true,
    auto_chain_phases: false,
  },
  standard: {
    stop_after_plan: false,
    stop_after_execute: true,
    stop_after_qa: false,
    auto_chain_phases: false,
  },
  confident: {
    stop_after_plan: false,
    stop_after_execute: false,
    stop_after_qa: false,
    auto_chain_phases: true,
  },
  'pure-vibe': {
    stop_after_plan: false,
    stop_after_execute: false,
    stop_after_qa: false,
    auto_chain_phases: true,
  },
};

export function resolveAutonomyProfile(autonomy: Autonomy): AutonomyProfile {
  return AUTONOMY_PROFILES[autonomy];
}
