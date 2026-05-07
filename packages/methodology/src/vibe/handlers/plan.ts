import { join } from 'node:path';

import { writeAtomically } from '@swt-labs/artifacts';
import type { Effort } from '@swt-labs/core';

import { resolveEffortProfile } from '../../profiles/effort.js';
import { NotImplementedError, RoutingError } from '../errors.js';
import { resolvePlanInput, type PlanInput } from '../orchestration/plan-input.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface PlanHandlerOptions {
  /** Resolve the target phase from the route + io. Defaults to using route.phase + route.phase_slug. */
  readonly resolveTarget?: (route: VibeRoute, io: ModeIO) =>
    | { phase: string; slug: string }
    | undefined;
  readonly planningDirName?: string;
  /** Effort profile override for tests. */
  readonly effort?: Effort;
}

/**
 * planHandler is a building block: it produces PLAN.md files for a phase but is
 * not registered directly with the registry. The composite planAndExecuteHandler
 * registers under `kind: 'plan-and-execute'` and calls planHandler internally.
 */
export function planHandler(opts: PlanHandlerOptions = {}): ModeHandler {
  return {
    kind: 'plan-and-execute',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const target = (opts.resolveTarget ?? defaultResolveTarget)(route, io);
      if (target === undefined) {
        throw new RoutingError('plan handler requires a phase target', { route });
      }
      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');
      const input = await resolvePlanInput({
        planningDir,
        phase: target.phase,
        slug: target.slug,
      });

      // Idempotence: if any plans already exist, skip generation.
      if (input.existingPlans.length > 0) {
        io.stdout.write(
          `◇ Plan handler — phase ${input.phase} already has ${input.existingPlans.length} plan(s); skipping generation.\n`,
        );
        return { route, exit: 0, ranTo: 'completion' };
      }

      const effort = opts.effort ?? 'balanced';
      const effortProfile = resolveEffortProfile(effort);
      const planCount = decidePlanCount(input, effortProfile.max_tasks_per_plan);
      const plans = synthesizePlans(input, planCount);

      for (const plan of plans) {
        await writeAtomically(
          join(input.phaseDir, `${input.phase}-${plan.plan}-PLAN.md`),
          renderPlanMarkdown(input, plan),
        );
      }

      io.stdout.write(
        [
          `✓ Plan handler — phase ${input.phase}: ${plans.length} plan(s) written`,
          ...plans.map((p) => `  ${input.phase}-${p.plan}-PLAN.md — ${p.title} (wave ${p.wave}, ${p.taskCount} tasks)`),
          '',
          `Effort: ${effort} | Skill profile: ${effortProfile.include_scout ? 'scout+lead' : 'lead-only'}`,
          '',
        ].join('\n'),
      );

      return { route, exit: 0, ranTo: 'completion' };
    },
  };
}

interface SynthesizedPlan {
  readonly plan: string; // "01"
  readonly title: string;
  readonly wave: number;
  readonly mustHaves: readonly string[];
  readonly taskCount: number;
}

function decidePlanCount(input: PlanInput, maxTasksPerPlan: number): number {
  if (input.mustHaves.length === 0) return 1;
  // One plan per ceil(must-haves / maxTasksPerPlan), capped at 5 to match VBW.
  return Math.min(5, Math.max(1, Math.ceil(input.mustHaves.length / maxTasksPerPlan)));
}

function synthesizePlans(input: PlanInput, count: number): readonly SynthesizedPlan[] {
  const plans: SynthesizedPlan[] = [];
  const buckets = bucketize(input.mustHaves, count);
  for (let i = 0; i < buckets.length; i += 1) {
    const planId = String(i + 1).padStart(2, '0');
    plans.push({
      plan: planId,
      title: buckets.length === 1 ? input.goal : `${input.goal} — part ${i + 1}`,
      wave: 1, // Default to wave 1; the Lead may override when subagent spawning is wired.
      mustHaves: buckets[i] ?? [],
      taskCount: buckets[i]?.length ?? 1,
    });
  }
  return plans;
}

function bucketize<T>(items: readonly T[], buckets: number): T[][] {
  if (buckets <= 0) return [[]];
  const out: T[][] = Array.from({ length: buckets }, () => []);
  for (let i = 0; i < items.length; i += 1) {
    out[i % buckets]?.push(items[i] as T);
  }
  return out;
}

function renderPlanMarkdown(input: PlanInput, plan: SynthesizedPlan): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`phase: "${input.phase}"`);
  lines.push(`plan: "${plan.plan}"`);
  lines.push(`title: ${JSON.stringify(plan.title)}`);
  lines.push(`wave: ${plan.wave}`);
  lines.push('depends_on: []');
  if (plan.mustHaves.length > 0) {
    lines.push('must_haves:');
    for (const m of plan.mustHaves) lines.push(`  - ${JSON.stringify(m)}`);
  } else {
    lines.push('must_haves: []');
  }
  lines.push('---');
  lines.push('');
  lines.push(`# Phase ${input.phase} / Plan ${plan.plan}: ${plan.title}`);
  lines.push('');
  lines.push(`**Goal:** ${input.goal}`);
  lines.push('');
  if (plan.mustHaves.length === 0) {
    lines.push('## Tasks');
    lines.push('');
    lines.push('1. Define the work for this plan based on phase context.');
    lines.push('');
  } else {
    lines.push('## Tasks');
    lines.push('');
    for (let i = 0; i < plan.mustHaves.length; i += 1) {
      lines.push(`${i + 1}. ${plan.mustHaves[i]}`);
    }
    lines.push('');
  }
  if (input.research !== undefined) {
    lines.push('## Research');
    lines.push('');
    lines.push(`See \`${input.phase}-RESEARCH.md\` for full findings.`);
    lines.push('');
  }
  return lines.join('\n');
}

function defaultResolveTarget(
  route: VibeRoute,
  _io: ModeIO,
): { phase: string; slug: string } | undefined {
  if (route.phase === undefined || route.phase_slug === undefined) {
    throw new NotImplementedError(
      'plan-and-execute',
      'Phase 9 / Plan 03b — interactive phase selection for plan mode. Until then, target a phase explicitly via `swt vibe N`.',
    );
  }
  // route.phase_slug is "<NN>-<slug>" — strip the leading NN-.
  const m = /^(\d{2})-(.+)$/.exec(route.phase_slug);
  if (m === null) return undefined;
  return { phase: m[1] ?? route.phase, slug: m[2] ?? '' };
}
