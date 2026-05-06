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
import type { Prompter } from '@swt-labs/core';
import { z } from 'zod';

import { runDiscussionEngine } from '../../discussion/engine.js';
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
  /** Optional prompter — when provided and resolve returns undefined, runs the discussion engine. */
  readonly prompter?: Prompter;
  /** Project name fallback used by the interactive path (defaults to reading PROJECT.md or 'project'). */
  readonly projectNameFallback?: string;
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

async function runInteractiveScope(
  opts: ScopeHandlerOptions,
  io: ModeIO,
): Promise<ScopeInput | undefined> {
  if (opts.prompter === undefined) return undefined;
  const result = await runDiscussionEngine({
    prompter: opts.prompter,
    context: { mode: 'scope' },
  });
  const milestone_name = pickValue(result.payload.answered, 'milestone_name');
  const scope_boundary = pickValue(result.payload.answered, 'scope_boundary');
  const decomposition_rationale = pickValue(result.payload.answered, 'decomposition_rationale');
  if (
    milestone_name === undefined ||
    scope_boundary === undefined ||
    decomposition_rationale === undefined
  ) {
    return undefined;
  }
  const phaseCountRaw =
    pickValue(result.payload.answered, 'phase_count') ??
    pickValue(result.payload.inferred, 'phase_count') ??
    '3';
  const phaseCount = Math.max(1, Math.min(9, Number.parseInt(phaseCountRaw, 10) || 3));

  const phases: PhaseEntry[] = [];
  for (let i = 1; i <= phaseCount; i += 1) {
    const position = i.toString().padStart(2, '0');
    const name = await opts.prompter.askText({
      prompt: `Phase ${position} name`,
      required: true,
    });
    const goal = await opts.prompter.askText({
      prompt: `Phase ${position} goal (one sentence)`,
      required: true,
    });
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `phase-${position}`;
    phases.push({ position, name, slug, goal, success_criteria: [], requirements: [] });
  }

  const project_name = await resolveProjectName(opts, io);
  return {
    project_name,
    milestone_name,
    scope_boundary,
    decomposition_rationale,
    phases,
  };
}

async function resolveProjectName(
  opts: ScopeHandlerOptions,
  io: ModeIO,
): Promise<string> {
  if (opts.projectNameFallback !== undefined) return opts.projectNameFallback;
  try {
    const raw = await readFile(join(io.cwd, '.swt-planning', 'PROJECT.md'), 'utf8');
    const m = /^#\s+(.+)$/m.exec(raw);
    if (m !== null) return (m[1] ?? '').trim() || 'project';
  } catch {
    // fall through
  }
  return 'project';
}

function pickValue(
  answers: ReadonlyArray<{ id: string; value: string }>,
  id: string,
): string | undefined {
  const a = answers.find((x) => x.id === id);
  return a !== undefined && a.value.length > 0 ? a.value : undefined;
}

export function scopeHandler(
  opts: ScopeHandlerOptions = { resolve: DEFAULT_SCOPE_RESOLVER },
): ModeHandler {
  return {
    kind: 'scope',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      let input = await opts.resolve(io);
      if (input === undefined && opts.prompter !== undefined) {
        input = await runInteractiveScope(opts, io);
      }
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
