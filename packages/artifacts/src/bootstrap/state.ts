import { join } from 'node:path';

import { writeAtomically } from '../atomic-write.js';

export interface WriteStateOptions {
  readonly planningDir: string;
  readonly project_name: string;
  readonly milestone_name?: string;
  readonly phase_count: number;
  /** ISO date string for the activity log. Defaults to today. */
  readonly date?: string;
}

export async function writeState(opts: WriteStateOptions): Promise<string> {
  const path = join(opts.planningDir, 'STATE.md');
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const milestone = opts.milestone_name ?? '_(no active milestone)_';

  const lines: string[] = [];
  lines.push('# State');
  lines.push('');
  lines.push(`**Project:** ${opts.project_name}`);
  lines.push(`**Milestone:** ${milestone}`);
  lines.push('');
  lines.push('## Current Phase');
  if (opts.phase_count === 0) {
    lines.push('Phase: 0 of 0');
    lines.push('Status: ready');
  } else {
    lines.push(`Phase: 1 of ${opts.phase_count}`);
    lines.push('Plans: 0/0');
    lines.push('Progress: 0%');
    lines.push('Status: ready');
  }
  lines.push('');
  lines.push('## Phase Status');
  if (opts.phase_count === 0) {
    lines.push('_(no phases yet — run `swt vibe` to scope)_');
  } else {
    for (let i = 1; i <= opts.phase_count; i += 1) {
      lines.push(`- **Phase ${i}:** Pending`);
    }
  }
  lines.push('');
  lines.push('## Key Decisions');
  lines.push('| Decision | Date | Rationale |');
  lines.push('|----------|------|-----------|');
  lines.push('| _(no decisions yet)_ | | |');
  lines.push('');
  lines.push('## Todos');
  lines.push('_(none)_');
  lines.push('');
  lines.push('## Blockers');
  lines.push('_(none)_');
  lines.push('');
  lines.push('## Activity Log');
  lines.push(`- ${date}: Project bootstrapped`);
  lines.push('');

  await writeAtomically(path, lines.join('\n'));
  return path;
}
