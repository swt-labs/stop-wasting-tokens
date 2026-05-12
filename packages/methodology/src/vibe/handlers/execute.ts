import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';
import type { DevSummaryPayload } from '@swt-labs/core';
import type { HarvestStrategy } from '@swt-labs/orchestration';
import type { TaskResult } from '@swt-labs/shared';

import { RoutingError } from '../errors.js';
import { runDevTasks, type DevTaskOutcome } from '../orchestration/dev-runner.js';
import { writeSummary } from '../orchestration/summary-writer.js';
import {
  groupByWave,
  validateDependencyOrder,
  validateDisjointFiles,
  type PlanRecord,
} from '../orchestration/waves.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface ExecuteHandlerOptions {
  /** Resolve the target phase from the route + io. */
  readonly resolveTarget?: (
    route: VibeRoute,
    io: ModeIO,
  ) => { phase: string; slug: string } | undefined;
  readonly planningDirName?: string;
  /**
   * HarvestStrategy passed straight through to `runDevTasks` → `createDispatcher`.
   * Defaults to `'stub'` so callers without a real Pi session (or recorded
   * cassette) still get a synthetic-success `TaskResult` per `TaskResultSchema`.
   * Production callers (`swt vibe` end-to-end at PR-15) wire the `'entries'`
   * strategy against the active Pi session's entry list.
   */
  readonly harvestStrategy?: HarvestStrategy;
}

export function executeHandler(opts: ExecuteHandlerOptions = {}): ModeHandler {
  return {
    kind: 'execute',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const target = (opts.resolveTarget ?? defaultResolveTarget)(route, io);
      if (target === undefined) {
        throw new RoutingError('execute handler requires a phase target', { route });
      }
      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');
      const phaseDir = join(planningDir, 'phases', `${target.phase}-${target.slug}`);

      const plans = await loadPlans(phaseDir, target.phase);
      if (plans.length === 0) {
        throw new RoutingError(
          `Phase ${target.phase} has no PLAN.md files — run \`swt vibe\` to plan first`,
          { phase: target.phase, slug: target.slug },
        );
      }

      const pending: PlanRecord[] = [];
      const completed: string[] = [];
      for (const plan of plans) {
        if (await hasSummary(phaseDir, target.phase, plan.plan)) {
          completed.push(plan.plan);
          continue;
        }
        pending.push(plan);
      }

      if (pending.length === 0) {
        io.stdout.write(
          `◇ Execute handler — phase ${target.phase}: all ${plans.length} plan(s) already have SUMMARY.md\n`,
        );
        return { route, exit: 0, ranTo: 'completion' };
      }

      validateDependencyOrder(pending);
      const waves = groupByWave(pending);
      for (const wave of waves) validateDisjointFiles(wave);

      const writtenSummaries: string[] = [];
      let degradedCount = 0;
      let haltReason: string | undefined;

      for (const wave of waves) {
        io.stdout.write(`◆ Wave ${wave.wave} — ${wave.plans.length} plan(s)\n`);
        const runSummary = await runDevTasks({
          phase: target.phase,
          plans: wave.plans,
          cwd: io.cwd,
          ...(opts.harvestStrategy !== undefined
            ? { opts: { harvestStrategy: opts.harvestStrategy } }
            : {}),
        });
        for (const outcome of runSummary.outcomes) {
          const summaryPayload = mapTaskResultToDevSummary(outcome, target.phase);
          if (summaryPayload.status !== 'complete') degradedCount += 1;
          const summaryPath = await writeSummary({
            phaseDir,
            phase: target.phase,
            plan: outcome.plan,
            summary: summaryPayload,
            text: renderSummaryText(outcome.result),
          });
          writtenSummaries.push(summaryPath);
          io.stdout.write(
            `  ${summaryPayload.status === 'complete' ? '✓' : '⚠'} ${target.phase}-${outcome.plan.plan}-SUMMARY.md\n`,
          );
        }
        if (runSummary.status === 'halted') {
          haltReason = runSummary.haltReason;
          break;
        }
      }

      io.stdout.write(
        [
          '',
          `✓ Execute handler — phase ${target.phase}: ${writtenSummaries.length} plan(s) processed (${completed.length} already complete)`,
          ...(degradedCount > 0
            ? [`⚠ ${degradedCount} plan(s) returned a non-complete TaskResult`]
            : []),
          ...(haltReason !== undefined
            ? [
                `⚠ Dev run halted: ${haltReason}`,
                '  Remaining waves NOT dispatched. Run QA/Debugger downstream.',
              ]
            : []),
          '',
        ].join('\n'),
      );

      return { route, exit: haltReason !== undefined ? 1 : 0, ranTo: 'completion' };
    },
  };
}

function mapTaskResultToDevSummary(outcome: DevTaskOutcome, phase: string): DevSummaryPayload {
  const tr: TaskResult = outcome.result;
  const status: DevSummaryPayload['status'] =
    tr.status === 'success' ? 'complete' : tr.status === 'partial' ? 'partial' : 'failed';
  return {
    phase,
    plan: outcome.plan.plan,
    status,
    tasks_completed: tr.status === 'success' ? 1 : 0,
    tasks_total: 1,
    files_modified: tr.files_changed.map((f) => f.path),
    commit_hashes: [],
    deviations: [],
  };
}

function renderSummaryText(tr: TaskResult): string {
  const parts: string[] = [];
  parts.push(`task_id: ${tr.task_id}`);
  parts.push(`status: ${tr.status}`);
  parts.push('');
  parts.push(tr.summary);
  if (tr.notes !== undefined && tr.notes.length > 0) {
    parts.push('');
    parts.push('## Notes');
    parts.push(tr.notes);
  }
  if (tr.blockers !== undefined && tr.blockers.length > 0) {
    parts.push('');
    parts.push('## Blockers');
    for (const b of tr.blockers) parts.push(`- ${b}`);
  }
  if (tr.must_haves.length > 0) {
    parts.push('');
    parts.push('## Must-haves');
    for (const mh of tr.must_haves) {
      parts.push(`- ${mh.id}: ${mh.status}${mh.evidence !== undefined ? ` — ${mh.evidence}` : ''}`);
    }
  }
  return parts.join('\n');
}

async function loadPlans(phaseDir: string, phase: string): Promise<readonly PlanRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(phaseDir);
  } catch {
    return [];
  }
  const planRe = new RegExp(`^${phase}-(\\d{2})-PLAN\\.md$`);
  const records: PlanRecord[] = [];
  for (const e of entries) {
    const m = planRe.exec(e);
    if (m === null) continue;
    const planId = m[1] ?? '';
    if (planId === '') continue;
    const raw = await readFile(join(phaseDir, e), 'utf8');
    const fm = parseFrontmatter<{
      title?: string;
      wave?: number;
      depends_on?: string[];
      files_modified?: string[];
    }>(raw).frontmatter;
    records.push({
      plan: planId,
      title: typeof fm.title === 'string' ? fm.title : `Plan ${planId}`,
      wave: typeof fm.wave === 'number' ? fm.wave : 1,
      depends_on: Array.isArray(fm.depends_on) ? fm.depends_on : [],
      files_modified: Array.isArray(fm.files_modified) ? fm.files_modified : [],
    });
  }
  records.sort((a, b) => a.plan.localeCompare(b.plan));
  return records;
}

async function hasSummary(phaseDir: string, phase: string, plan: string): Promise<boolean> {
  try {
    const st = await stat(join(phaseDir, `${phase}-${plan}-SUMMARY.md`));
    return st.isFile();
  } catch {
    return false;
  }
}

function defaultResolveTarget(
  route: VibeRoute,
  _io: ModeIO,
): { phase: string; slug: string } | undefined {
  if (route.phase === undefined || route.phase_slug === undefined) return undefined;
  const m = /^(\d{2})-(.+)$/.exec(route.phase_slug);
  if (m === null) return undefined;
  return { phase: m[1] ?? route.phase, slug: m[2] ?? '' };
}
