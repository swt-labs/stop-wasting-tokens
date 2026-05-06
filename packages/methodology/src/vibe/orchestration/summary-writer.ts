import { join } from 'node:path';

import { writeAtomically } from '@swt-labs/artifacts';
import type { DevSummaryPayload } from '@swt-labs/core';

import type { PlanRecord } from './waves.js';

export interface WriteSummaryOptions {
  readonly phaseDir: string;
  readonly phase: string;
  readonly plan: PlanRecord;
  readonly summary: DevSummaryPayload | undefined;
  /** Optional rendered text from the Dev to include in the summary body. */
  readonly text?: string;
  /** Marker date when the summary was written. Defaults to today (YYYY-MM-DD). */
  readonly completed?: string;
}

export async function writeSummary(opts: WriteSummaryOptions): Promise<string> {
  const path = join(opts.phaseDir, `${opts.phase}-${opts.plan.plan}-SUMMARY.md`);
  const completed = opts.completed ?? new Date().toISOString().slice(0, 10);

  const status = opts.summary?.status ?? 'partial';
  const tasksCompleted = opts.summary?.tasks_completed ?? 0;
  const tasksTotal = opts.summary?.tasks_total ?? 0;
  const filesModified = opts.summary?.files_modified ?? [];
  const commitHashes = opts.summary?.commit_hashes ?? [];
  const deviations = opts.summary?.deviations ?? [];

  const lines: string[] = [];
  lines.push('---');
  lines.push(`phase: "${opts.phase}"`);
  lines.push(`plan: "${opts.plan.plan}"`);
  lines.push(`title: ${JSON.stringify(opts.plan.title)}`);
  lines.push(`status: ${status}`);
  lines.push(`completed: ${completed}`);
  lines.push(`tasks_completed: ${tasksCompleted}`);
  lines.push(`tasks_total: ${tasksTotal}`);
  if (commitHashes.length > 0) {
    lines.push('commit_hashes:');
    for (const h of commitHashes) lines.push(`  - ${h}`);
  }
  if (filesModified.length > 0) {
    lines.push('files_modified:');
    for (const f of filesModified) lines.push(`  - ${f}`);
  }
  if (deviations.length > 0) {
    lines.push('deviations:');
    for (const d of deviations) {
      lines.push(`  - id: ${d.id}`);
      lines.push(`    description: ${JSON.stringify(d.description)}`);
      lines.push(`    rationale: ${JSON.stringify(d.rationale)}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(`# Plan ${opts.plan.plan}: ${opts.plan.title}`);
  lines.push('');
  if (opts.text !== undefined && opts.text.trim().length > 0) {
    lines.push(opts.text.trim());
    lines.push('');
  } else {
    lines.push('_(no Dev output captured — summary synthesized from spawn metadata)_');
    lines.push('');
  }

  await writeAtomically(path, lines.join('\n'));
  return path;
}
