import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';
import type { AgentSpec, AgentSpawner, Effort } from '@swt-labs/core';

import { runDev } from '../orchestration/dev-runner.js';
import { writeSummary } from '../orchestration/summary-writer.js';
import { groupByWave, validateDependencyOrder, validateDisjointFiles, type PlanRecord } from '../orchestration/waves.js';
import { NotImplementedError, RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface ExecuteHandlerOptions {
  /** Resolve the target phase from the route + io. */
  readonly resolveTarget?: (route: VibeRoute, io: ModeIO) =>
    | { phase: string; slug: string }
    | undefined;
  readonly planningDirName?: string;
  /**
   * Required for real Dev work; tests inject a MockAgentSpawner. When unset
   * the handler throws NotImplementedError pointing at the codex-driver
   * AgentSpawner work item.
   */
  readonly spawner?: AgentSpawner;
  readonly devSpec?: AgentSpec;
  readonly effort?: Effort;
  /** Override session id for deterministic tests. */
  readonly sessionId?: string;
}

export function executeHandler(opts: ExecuteHandlerOptions = {}): ModeHandler {
  return {
    kind: 'execute',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const target = (opts.resolveTarget ?? defaultResolveTarget)(route, io);
      if (target === undefined) {
        throw new RoutingError('execute handler requires a phase target', { route });
      }
      if (opts.spawner === undefined || opts.devSpec === undefined) {
        throw new NotImplementedError(
          'execute',
          'Phase 9 / Plan 04+ — real Codex AgentSpawner. Until then, inject a Mock via executeHandler({spawner, devSpec}).',
        );
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

      // Skip plans that already have a SUMMARY.md.
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

      const sessionId = opts.sessionId ?? `swt-${Date.now().toString(36)}`;
      const writtenSummaries: string[] = [];
      let degradedCount = 0;

      for (const wave of waves) {
        io.stdout.write(`◆ Wave ${wave.wave} — ${wave.plans.length} plan(s)\n`);
        const results = await Promise.all(
          wave.plans.map((plan) =>
            runDev({
              phase: target.phase,
              plan,
              phaseDir,
              spec: opts.devSpec!,
              spawner: opts.spawner!,
              cwd: io.cwd,
              sessionId,
            }),
          ),
        );
        for (const result of results) {
          if (result.degraded) degradedCount += 1;
          const summaryPath = await writeSummary({
            phaseDir,
            phase: target.phase,
            plan: result.plan,
            summary: result.summary,
            ...(typeof result.raw.text === 'string' ? { text: result.raw.text } : {}),
          });
          writtenSummaries.push(summaryPath);
          io.stdout.write(
            `  ${result.degraded ? '⚠' : '✓'} ${target.phase}-${result.plan.plan}-SUMMARY.md\n`,
          );
        }
      }

      io.stdout.write(
        [
          '',
          `✓ Execute handler — phase ${target.phase}: ${pending.length} plan(s) processed (${completed.length} already complete)`,
          ...(degradedCount > 0
            ? [`⚠ ${degradedCount} plan(s) returned a degraded summary (no structured handoff)`]
            : []),
          '',
        ].join('\n'),
      );

      return { route, exit: 0, ranTo: 'completion' };
    },
  };
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
