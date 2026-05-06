import { join } from 'node:path';

import { writeAtomically } from '../atomic-write.js';
import { type PhaseEntry, RoadmapSchema } from '../schemas/roadmap.js';

export interface WriteRoadmapOptions {
  readonly planningDir: string;
  readonly project_name: string;
  readonly goal?: string;
  readonly phases: readonly PhaseEntry[];
}

export async function writeRoadmap(opts: WriteRoadmapOptions): Promise<string> {
  // Validate the roadmap shape before writing.
  RoadmapSchema.parse({ project_name: opts.project_name, phases: [...opts.phases] });

  const path = join(opts.planningDir, 'ROADMAP.md');
  const lines: string[] = [];

  lines.push(`# ${opts.project_name} Roadmap`);
  lines.push('');
  if (opts.goal !== undefined && opts.goal.trim().length > 0) {
    lines.push(`**Goal:** ${opts.goal}`);
    lines.push('');
  }
  lines.push(`**Scope:** ${opts.phases.length} phase${opts.phases.length === 1 ? '' : 's'}`);
  lines.push('');

  lines.push('## Progress');
  lines.push('| Phase | Status | Plans | Tasks | Commits |');
  lines.push('|-------|--------|-------|-------|---------|');
  for (const phase of opts.phases) {
    lines.push(`| ${phase.position} | ${formatStatus(phase.status)} | 0 | 0 | 0 |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Phase List');
  for (const phase of opts.phases) {
    const anchor = sectionAnchor(phase);
    const checkbox = phase.status === 'complete' ? '[x]' : '[ ]';
    lines.push(`- ${checkbox} [Phase ${parseInt(phase.position, 10)}: ${phase.name}](#${anchor})`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const phase of opts.phases) {
    lines.push(`## Phase ${parseInt(phase.position, 10)}: ${phase.name}`);
    lines.push('');
    lines.push(`**Goal:** ${phase.goal}`);
    lines.push('');
    if (phase.requirements.length > 0) {
      lines.push(`**Requirements:** ${phase.requirements.join(', ')}`);
      lines.push('');
    }
    if (phase.success_criteria.length > 0) {
      lines.push('**Success Criteria:**');
      for (const c of phase.success_criteria) lines.push(`- ${c}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  await writeAtomically(path, lines.join('\n'));
  return path;
}

function formatStatus(status: PhaseEntry['status']): string {
  switch (status) {
    case 'complete':
      return '● Done';
    case 'in-progress':
      return '◆ In progress';
    case 'planned':
      return '○ Planned';
    case 'pending':
      return 'Pending';
  }
}

function sectionAnchor(phase: PhaseEntry): string {
  const slug = `phase-${parseInt(phase.position, 10)}-${phase.name.toLowerCase()}`;
  return slug
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}
