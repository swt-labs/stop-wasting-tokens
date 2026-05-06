import { join } from 'node:path';

import { writeUat } from '@swt-labs/artifacts';

import { synthesizeUatChecklist } from '../../qa/checklist.js';
import { RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface VerifyHandlerOptions {
  readonly resolveTarget?: (route: VibeRoute, io: ModeIO) =>
    | { phase: string; slug: string }
    | undefined;
  readonly planningDirName?: string;
  /** Override 'today' for deterministic tests. */
  readonly today?: () => string;
  /**
   * Default status for synthesized rows. PLAN 06 will switch this to 'pass'/'fail'
   * via inline checkpoints. Until then, rows land as 'deferred' so the artifact
   * shape mirrors the mechanical UAT pass.
   */
  readonly defaultRowStatus?: 'pass' | 'fail' | 'skipped' | 'deferred';
}

export function verifyHandler(opts: VerifyHandlerOptions = {}): ModeHandler {
  return {
    kind: 'verify',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const target = (opts.resolveTarget ?? defaultResolveTarget)(route, io);
      if (target === undefined) {
        throw new RoutingError('verify handler requires a phase target', { route });
      }

      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');
      const phaseDir = join(planningDir, 'phases', `${target.phase}-${target.slug}`);

      const today = (opts.today ?? defaultToday)();
      const status = opts.defaultRowStatus ?? 'deferred';

      const { plans, tests } = await synthesizeUatChecklist({
        phaseDir,
        phase: target.phase,
        defaultStatus: status,
      });
      if (plans.length === 0) {
        throw new RoutingError(
          `Phase ${target.phase} has no PLAN.md files — nothing to verify`,
          { phase: target.phase, slug: target.slug },
        );
      }

      const passed = tests.filter((t) => t.status === 'pass').length;
      const failed = tests.filter((t) => t.status === 'fail').length;
      const skipped = tests.filter((t) => t.status === 'skipped').length;
      const aggregateStatus: 'complete' | 'partial' | 'failed' = failed > 0 ? 'failed' : 'complete';

      const path = await writeUat({
        phaseDir,
        doc: {
          phase: target.phase,
          plan_count: plans.length,
          status: aggregateStatus,
          started: today,
          completed: today,
          total_tests: tests.length,
          passed,
          skipped,
          issues: failed,
          tests: [...tests],
          issue_records: [],
          body: '',
        },
      });

      io.stdout.write(
        `✓ Verify handler — phase ${target.phase}: wrote ${path.split('/').pop()} (${tests.length} test rows, default status=${status})\n`,
      );

      return { route, exit: failed > 0 ? 1 : 0, ranTo: 'completion' };
    },
  };
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultResolveTarget(
  route: VibeRoute,
  _io: ModeIO,
): { phase: string; slug: string } | undefined {
  if (route.phase === undefined || route.phase_slug === undefined) return undefined;
  const m = /^(\d{2})-(.+)$/.exec(route.phase_slug);
  if (m === null) return { phase: route.phase, slug: '' };
  return { phase: m[1] ?? route.phase, slug: m[2] ?? '' };
}
