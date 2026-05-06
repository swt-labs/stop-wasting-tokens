import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  PhaseEntrySchema,
  createPhaseDir,
  writeMilestoneContext,
  writePhaseContext,
  writeRoadmap,
  writeState,
  type PhaseEntry,
} from '@swt-labs/artifacts';
import { z } from 'zod';

import { NotImplementedError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export const ScopeInputSchema = z.object({
  project_name: z.string().min(1),
  milestone_name: z.string().min(1),
  scope_boundary: z.string().min(1),
  decomposition_rationale: z.string().min(1),
  phases: z.array(PhaseEntrySchema).min(1),
});

export type ScopeInput = z.infer<typeof ScopeInputSchema>;

export interface ScopeHandlerOptions {
  readonly resolve: (io: ModeIO) => Promise<ScopeInput | undefined>;
  readonly planningDirName?: string;
}

export const DEFAULT_SCOPE_RESOLVER = async (
  io: ModeIO,
): Promise<ScopeInput | undefined> => {
  const path = join(io.cwd, '.swt-planning', 'phases.json');
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return ScopeInputSchema.parse(parsed);
  } catch {
    return undefined;
  }
};

export function scopeHandler(
  opts: ScopeHandlerOptions = { resolve: DEFAULT_SCOPE_RESOLVER },
): ModeHandler {
  return {
    kind: 'scope',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const input = await opts.resolve(io);
      if (input === undefined) {
        throw new NotImplementedError(
          'scope',
          'Phase 9 / Plan 03b — interactive scope decomposition. Until then, place a ScopeInput JSON ({project_name, milestone_name, scope_boundary, decomposition_rationale, phases[]}) at .swt-planning/phases.json and re-run.',
        );
      }
      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');

      // Create phase directories + per-phase CONTEXT.md.
      for (const phase of input.phases) {
        await createPhaseDir({
          planningDir,
          position: phase.position,
          slug: phase.slug,
          name: phase.name,
          goal: phase.goal,
        });
        await writePhaseContext({
          planningDir,
          position: phase.position,
          slug: phase.slug,
          name: phase.name,
          goal: phase.goal,
        });
      }

      const roadmapPath = await writeRoadmap({
        planningDir,
        project_name: input.project_name,
        goal: input.milestone_name,
        phases: input.phases as readonly PhaseEntry[],
      });

      const statePath = await writeState({
        planningDir,
        project_name: input.project_name,
        milestone_name: input.milestone_name,
        phase_count: input.phases.length,
      });

      const contextPath = await writeMilestoneContext({
        planningDir,
        milestone_name: input.milestone_name,
        scope_boundary: input.scope_boundary,
        decomposition_rationale: input.decomposition_rationale,
        requirement_mapping: input.phases.map((p) => ({
          phase: p.position,
          reqs: [...p.requirements],
        })),
      });

      io.stdout.write(
        [
          `✓ Scope complete — ${input.phases.length} phase${input.phases.length === 1 ? '' : 's'} created`,
          `  ROADMAP.md: ${roadmapPath}`,
          `  STATE.md: ${statePath}`,
          `  CONTEXT.md: ${contextPath}`,
          '',
          'Next: run `swt vibe` to enter Phase 1 (Plan + Execute).',
          '',
        ].join('\n'),
      );

      return { route, exit: 0, ranTo: 'completion' };
    },
  };
}
