import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseFrontmatter } from '@swt-labs/artifacts';
import type { Prompter } from '@swt-labs/core';

import { RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export type RecoveryDecision = 'create-remediation' | 'start-fresh' | 'skip';

export interface MilestoneUatIssue {
  readonly milestoneSlug: string;
  readonly phase: string;
  readonly phaseSlug: string;
  readonly status: string;
  readonly issues: number;
  readonly majorOrHigher: boolean;
}

export interface MilestoneUatRecoveryHandlerOptions {
  readonly planningDirName?: string;
  readonly prompter?: Prompter;
  /** Force a specific recovery decision (test fixture / --yolo path). */
  readonly forceDecision?: RecoveryDecision;
  /** Override 'today' for deterministic tests. */
  readonly today?: () => string;
  /** Override the latest milestone discovery for tests. */
  readonly resolveLatestMilestone?: (planningDir: string) => Promise<string | undefined>;
}

export function milestoneUatRecoveryHandler(
  opts: MilestoneUatRecoveryHandlerOptions = {},
): ModeHandler {
  return {
    kind: 'milestone-uat-recovery',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');
      const latest = await (opts.resolveLatestMilestone ?? defaultResolveLatestMilestone)(planningDir);
      if (latest === undefined) {
        throw new RoutingError(
          'milestone-uat-recovery: no milestones present under .swt-planning/milestones/',
          { route },
        );
      }

      const milestoneDir = join(planningDir, 'milestones', latest);
      const issues = await scanMilestonePhases(milestoneDir, latest);

      if (issues.length === 0) {
        io.stdout.write(
          `◇ Milestone UAT recovery — ${latest}: no unresolved issues found\n`,
        );
        return { route, exit: 0, ranTo: 'completion' };
      }

      io.stdout.write(`◆ Milestone UAT recovery — ${latest}: ${issues.length} affected phase(s)\n`);
      for (const i of issues) {
        io.stdout.write(
          `  - phase ${i.phase} (${i.phaseSlug}): ${i.issues} issue(s), status=${i.status}${i.majorOrHigher ? ', severity≥major' : ''}\n`,
        );
      }

      const decision =
        opts.forceDecision ?? (await promptDecision(opts.prompter, issues));

      if (decision === 'skip') {
        io.stdout.write('○ Milestone UAT recovery — skipped (will re-trigger on next /vbw:vibe)\n');
        return { route, exit: 0, ranTo: 'completion' };
      }

      if (decision === 'start-fresh') {
        const today = (opts.today ?? defaultToday)();
        for (const i of issues) {
          const markerPath = join(
            milestoneDir,
            'phases',
            `${i.phase}-${i.phaseSlug}`,
            '.remediated',
          );
          await writeFile(markerPath, `acknowledged_at: ${today}\n`, 'utf8');
        }
        io.stdout.write(
          `✓ Milestone UAT recovery — start-fresh: wrote .remediated markers for ${issues.length} phase(s)\n`,
        );
        return { route, exit: 0, ranTo: 'completion' };
      }

      // create-remediation: PLAN 06 only writes the marker decision; the CLI
      // composes the existing add-phase flow when this handler returns.
      io.stdout.write(
        `◆ Milestone UAT recovery — create-remediation: ${issues.length} remediation phase(s) requested\n`,
      );
      io.stdout.write(
        '  Note: handler returns the decision; CLI is responsible for invoking the add-phase flow per affected phase.\n',
      );
      return {
        route,
        exit: 0,
        ranTo: 'completion',
        message: JSON.stringify({ decision, issues }),
      };
    },
  };
}

async function promptDecision(
  prompter: Prompter | undefined,
  issues: readonly MilestoneUatIssue[],
): Promise<RecoveryDecision> {
  if (prompter === undefined) return 'skip';
  return prompter.askChoice<RecoveryDecision>({
    prompt: `Milestone has ${issues.length} unresolved UAT phase(s). What now?`,
    options: [
      { value: 'create-remediation', label: 'Create remediation phases' },
      { value: 'start-fresh', label: 'Start fresh with new work' },
      { value: 'skip', label: 'Not now (re-trigger next session)' },
    ],
    defaultValue: issues.some((i) => i.majorOrHigher) ? 'create-remediation' : 'skip',
  });
}

async function defaultResolveLatestMilestone(planningDir: string): Promise<string | undefined> {
  const milestonesDir = join(planningDir, 'milestones');
  let entries: string[];
  try {
    entries = await readdir(milestonesDir);
  } catch {
    return undefined;
  }
  const dirs: string[] = [];
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const s = await stat(join(milestonesDir, e));
    if (s.isDirectory()) dirs.push(e);
  }
  if (dirs.length === 0) return undefined;
  dirs.sort();
  return dirs[dirs.length - 1];
}

async function scanMilestonePhases(
  milestoneDir: string,
  milestoneSlug: string,
): Promise<MilestoneUatIssue[]> {
  const phasesDir = join(milestoneDir, 'phases');
  let entries: string[];
  try {
    entries = await readdir(phasesDir);
  } catch {
    return [];
  }
  const out: MilestoneUatIssue[] = [];
  for (const e of entries) {
    const m = /^(\d{2})-(.+)$/.exec(e);
    if (m === null) continue;
    const phase = m[1] ?? '';
    const slug = m[2] ?? '';
    const phaseDir = join(phasesDir, e);
    const remediated = await fileExists(join(phaseDir, '.remediated'));
    if (remediated) continue;
    const uatPath = join(phaseDir, `${phase}-UAT.md`);
    const exists = await fileExists(uatPath);
    if (!exists) continue;
    const raw = await readFile(uatPath, 'utf8');
    const fm = parseFrontmatter<{ status?: string; issues?: number }>(raw).frontmatter;
    const status = String(fm.status ?? '');
    const issues = Number(fm.issues ?? 0);
    if (status === 'complete' && issues === 0) continue;
    if (status === '' && issues === 0) continue;
    const majorOrHigher = /critical|major/.test(raw);
    out.push({
      milestoneSlug,
      phase,
      phaseSlug: slug,
      status: status.length > 0 ? status : 'unknown',
      issues,
      majorOrHigher,
    });
  }
  out.sort((a, b) => a.phase.localeCompare(b.phase));
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}
