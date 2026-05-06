export interface TraceabilityInput {
  readonly requirements: readonly string[]; // REQ-IDs
  readonly plans: readonly TraceabilityPlan[];
  readonly summaries: readonly TraceabilitySummary[];
}

export interface TraceabilityPlan {
  readonly phase: string;
  readonly plan: string;
  readonly requirements: readonly string[];
  readonly must_haves: readonly string[];
}

export interface TraceabilitySummary {
  readonly phase: string;
  readonly plan: string;
  readonly status: string;
  /** Acceptance check IDs that the SUMMARY claims to address. */
  readonly ac_ids?: readonly string[];
}

export interface TraceabilityReport {
  readonly unmapped_requirements: readonly string[];
  readonly dangling_requirement_refs: readonly DanglingRef[];
  readonly plans_without_summary: readonly string[]; // "phase-plan"
  readonly summaries_for_unknown_plans: readonly string[]; // "phase-plan"
  readonly ok: boolean;
}

export interface DanglingRef {
  readonly phase: string;
  readonly plan: string;
  readonly reference: string;
}

export function checkTraceability(input: TraceabilityInput): TraceabilityReport {
  const reqSet = new Set(input.requirements);
  const planKeys = new Set(input.plans.map((p) => `${p.phase}-${p.plan}`));
  const summaryKeys = new Set(input.summaries.map((s) => `${s.phase}-${s.plan}`));

  const referenced = new Set<string>();
  const dangling: DanglingRef[] = [];
  for (const plan of input.plans) {
    for (const ref of plan.requirements) {
      if (reqSet.has(ref)) referenced.add(ref);
      else dangling.push({ phase: plan.phase, plan: plan.plan, reference: ref });
    }
  }

  const unmapped = input.requirements.filter((id) => !referenced.has(id));
  const plansWithoutSummary = [...planKeys].filter((k) => !summaryKeys.has(k));
  const summariesForUnknown = [...summaryKeys].filter((k) => !planKeys.has(k));

  return {
    unmapped_requirements: unmapped,
    dangling_requirement_refs: dangling,
    plans_without_summary: plansWithoutSummary.sort(),
    summaries_for_unknown_plans: summariesForUnknown.sort(),
    ok:
      unmapped.length === 0 &&
      dangling.length === 0 &&
      plansWithoutSummary.length === 0 &&
      summariesForUnknown.length === 0,
  };
}
