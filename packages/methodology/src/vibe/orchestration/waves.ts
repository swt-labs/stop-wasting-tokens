import { RoutingError } from '../errors.js';

export interface PlanRecord {
  readonly plan: string; // "01"
  readonly title: string;
  readonly wave: number;
  readonly depends_on: readonly string[];
  readonly files_modified: readonly string[];
}

export interface Wave {
  readonly wave: number;
  readonly plans: readonly PlanRecord[];
}

/**
 * Group plans by wave and return them in ascending wave order. Plans within a
 * wave keep their declared order.
 */
export function groupByWave(plans: readonly PlanRecord[]): readonly Wave[] {
  const buckets = new Map<number, PlanRecord[]>();
  for (const plan of plans) {
    const arr = buckets.get(plan.wave);
    if (arr === undefined) buckets.set(plan.wave, [plan]);
    else arr.push(plan);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([wave, ps]) => ({ wave, plans: ps }));
}

/**
 * Reject same-wave plans whose `files_modified` overlap. Cross-wave plans are
 * allowed to overlap (sequencing prevents the conflict).
 */
export function validateDisjointFiles(wave: Wave): void {
  const seen = new Map<string, string>();
  for (const plan of wave.plans) {
    for (const file of plan.files_modified) {
      const owner = seen.get(file);
      if (owner !== undefined) {
        throw new RoutingError(
          `Wave ${wave.wave}: plans ${owner} and ${plan.plan} both declare files_modified for "${file}"`,
          { wave: wave.wave, file, owner, conflicting: plan.plan },
        );
      }
      seen.set(file, plan.plan);
    }
  }
}

/**
 * Reject `depends_on` references that point to plans in the same or a later
 * wave (cycles / forward refs are illegal).
 */
export function validateDependencyOrder(plans: readonly PlanRecord[]): void {
  const waveOf = new Map<string, number>();
  for (const plan of plans) waveOf.set(plan.plan, plan.wave);
  for (const plan of plans) {
    for (const dep of plan.depends_on) {
      const depWave = waveOf.get(dep);
      if (depWave === undefined) {
        throw new RoutingError(`Plan ${plan.plan} depends on unknown plan "${dep}"`, {
          plan: plan.plan,
          depends_on: dep,
        });
      }
      if (depWave >= plan.wave) {
        throw new RoutingError(
          `Plan ${plan.plan} (wave ${plan.wave}) depends on ${dep} (wave ${depWave}); deps must be in earlier waves`,
          { plan: plan.plan, plan_wave: plan.wave, dep, dep_wave: depWave },
        );
      }
    }
  }
}
