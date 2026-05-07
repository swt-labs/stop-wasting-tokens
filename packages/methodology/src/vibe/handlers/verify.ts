import { join } from 'node:path';

import { writeUat, type UatIssue, type UatTest } from '@swt-labs/artifacts';
import type { Prompter } from '@swt-labs/core';

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
   * When supplied, the handler runs the inline checkpoint loop: askChoice
   * per test row, askText/askChoice on FAIL for issue capture. When omitted,
   * falls back to today's deferred-row default behavior.
   */
  readonly prompter?: Prompter;
  /**
   * Default status for synthesized rows when no prompter is supplied. Defaults
   * to 'deferred' so the existing mechanical UAT pass shape is preserved.
   */
  readonly defaultRowStatus?: 'pass' | 'fail' | 'skipped' | 'deferred';
  /**
   * Pure-vibe / yolo autonomy short-circuits the prompter — every row lands as
   * the configured `defaultRowStatus`. This mirrors VBW's `--yolo` flag.
   */
  readonly autonomy?: 'pure-vibe' | 'cautious' | 'standard' | 'confident';
}

type RowDecision = 'pass' | 'fail' | 'skipped' | 'deferred';
type Severity = 'critical' | 'major' | 'minor' | 'cosmetic';

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
      const fallbackStatus = opts.defaultRowStatus ?? 'deferred';

      const { plans, tests: synthesized } = await synthesizeUatChecklist({
        phaseDir,
        phase: target.phase,
        defaultStatus: fallbackStatus,
      });
      if (plans.length === 0) {
        throw new RoutingError(
          `Phase ${target.phase} has no PLAN.md files — nothing to verify`,
          { phase: target.phase, slug: target.slug },
        );
      }

      const useInteractive =
        opts.prompter !== undefined && opts.autonomy !== 'pure-vibe';

      let tests: UatTest[];
      const issueRecords: UatIssue[] = [];
      if (useInteractive) {
        tests = [];
        for (const row of synthesized) {
          const decision = await opts.prompter.askChoice<RowDecision>({
            prompt: `${row.id} — ${row.description}`,
            options: [
              { value: 'pass', label: 'PASS' },
              { value: 'fail', label: 'FAIL' },
              { value: 'skipped', label: 'SKIP' },
              { value: 'deferred', label: 'DEFER' },
            ],
            defaultValue: 'pass',
          });
          let notes = row.notes;
          if (decision === 'fail') {
            const summary = await opts.prompter.askText({
              prompt: `Describe the failure for ${row.id}`,
              required: true,
            });
            const severity = await opts.prompter.askChoice<Severity>({
              prompt: `Severity for ${row.id}`,
              options: [
                { value: 'critical', label: 'critical' },
                { value: 'major', label: 'major' },
                { value: 'minor', label: 'minor' },
                { value: 'cosmetic', label: 'cosmetic' },
              ],
              defaultValue: 'major',
            });
            issueRecords.push({
              id: `I-${target.phase}-${row.id}`,
              severity,
              summary,
              details: row.notes,
            });
            notes = summary;
          }
          tests.push({ ...row, status: decision, notes });
        }
      } else {
        tests = synthesized.map((t) => ({ ...t }));
      }

      const passed = tests.filter((t) => t.status === 'pass').length;
      const failed = tests.filter((t) => t.status === 'fail').length;
      const skipped = tests.filter((t) => t.status === 'skipped').length;
      const aggregateStatus: 'complete' | 'partial' | 'failed' =
        failed > 0 ? 'failed' : skipped > 0 ? 'partial' : 'complete';

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
          tests,
          issue_records: issueRecords,
          body: '',
        },
      });

      const mode = useInteractive ? 'interactive' : `default=${fallbackStatus}`;
      io.stdout.write(
        `✓ Verify handler — phase ${target.phase}: wrote ${path.split('/').pop()} (${tests.length} rows, ${mode}, ${passed} pass / ${failed} fail / ${skipped} skip)\n`,
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
