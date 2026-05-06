import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  EMPTY_DISCOVERY,
  readDiscovery,
  writeDiscovery,
  writeOrUpdateClaudeMd,
  writeProject,
  writeRequirements,
  writeRoadmap,
  writeState,
} from '@swt-labs/artifacts';
import type { Prompter } from '@swt-labs/core';

import { runDiscussionEngine } from '../../discussion/engine.js';
import { NotImplementedError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface BootstrapInput {
  readonly project_name: string;
  readonly description: string;
  readonly core_value?: string;
}

export interface BootstrapHandlerOptions {
  /** Resolve the BootstrapInput from disk or env. */
  readonly resolve: (io: ModeIO) => Promise<BootstrapInput | undefined>;
  /** Override the planning dir name (defaults to '.swt-planning'). */
  readonly planningDirName?: string;
  /** Optional prompter — when provided and resolve returns undefined, runs the discussion engine. */
  readonly prompter?: Prompter;
}

export const DEFAULT_BOOTSTRAP_RESOLVER = async (
  io: ModeIO,
): Promise<BootstrapInput | undefined> => {
  // Look for `.swt-planning/bootstrap-input.json` for non-interactive bootstraps.
  const path = join(io.cwd, '.swt-planning', 'bootstrap-input.json');
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BootstrapInput>;
    if (typeof parsed.project_name === 'string' && typeof parsed.description === 'string') {
      return {
        project_name: parsed.project_name,
        description: parsed.description,
        ...(typeof parsed.core_value === 'string' ? { core_value: parsed.core_value } : {}),
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export function bootstrapHandler(
  opts: BootstrapHandlerOptions = { resolve: DEFAULT_BOOTSTRAP_RESOLVER },
): ModeHandler {
  return {
    kind: 'bootstrap',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      let input = await opts.resolve(io);
      if (input === undefined && opts.prompter !== undefined) {
        const result = await runDiscussionEngine({
          prompter: opts.prompter,
          context: { mode: 'bootstrap' },
        });
        const project_name = pickValue(result.payload.answered, 'project_name');
        const description = pickValue(result.payload.answered, 'description');
        const core_value = pickValueOrUndefined(result.payload.answered, 'core_value');
        if (project_name !== undefined && description !== undefined) {
          input = {
            project_name,
            description,
            ...(core_value !== undefined ? { core_value } : {}),
          };
        }
      }
      if (input === undefined) {
        throw new NotImplementedError(
          'bootstrap',
          'Phase 9 / Plan 03b — interactive bootstrap. Until then, place a {project_name, description, core_value?} JSON at .swt-planning/bootstrap-input.json and re-run.',
        );
      }
      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');
      const coreValue = input.core_value ?? input.description;

      // Ensure planning dir + discovery.json.
      const existingDiscovery = await readDiscovery(planningDir).catch(() => EMPTY_DISCOVERY);
      await writeDiscovery(planningDir, existingDiscovery);

      const projectPath = await writeProject({
        planningDir,
        name: input.project_name,
        description: input.description,
        ...(input.core_value !== undefined ? { core_value: input.core_value } : {}),
      });
      const requirementsPath = await writeRequirements({
        planningDir,
        project_name: input.project_name,
        core_value: coreValue,
        discovery: existingDiscovery,
      });
      const roadmapPath = await writeRoadmap({
        planningDir,
        project_name: input.project_name,
        phases: [],
      });
      const statePath = await writeState({
        planningDir,
        project_name: input.project_name,
        phase_count: 0,
      });
      const claudeMdPath = join(io.cwd, 'CLAUDE.md');
      const claudeExists = await fileExists(claudeMdPath);
      await writeOrUpdateClaudeMd({
        path: claudeMdPath,
        project_name: input.project_name,
        core_value: coreValue,
        preserve_existing: claudeExists,
      });

      io.stdout.write(
        [
          '✓ Bootstrap complete',
          `  PROJECT.md: ${projectPath}`,
          `  REQUIREMENTS.md: ${requirementsPath}`,
          `  ROADMAP.md: ${roadmapPath}`,
          `  STATE.md: ${statePath}`,
          `  CLAUDE.md: ${claudeMdPath}`,
          '',
          'Next: run `swt vibe` again to scope the milestone (place a phases payload at .swt-planning/phases.json or wait for PLAN 03b interactive scope).',
          '',
        ].join('\n'),
      );

      return { route, exit: 0, ranTo: 'completion' };
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

function pickValue(
  answers: ReadonlyArray<{ id: string; value: string }>,
  id: string,
): string | undefined {
  const a = answers.find((x) => x.id === id);
  return a !== undefined && a.value.length > 0 ? a.value : undefined;
}

function pickValueOrUndefined(
  answers: ReadonlyArray<{ id: string; value: string }>,
  id: string,
): string | undefined {
  return pickValue(answers, id);
}
