import { join } from 'node:path';

import { writeAtomically } from '../atomic-write.js';
import { formatFrontmatter } from '../frontmatter.js';

export interface WritePhaseContextOptions {
  readonly planningDir: string;
  readonly position: string; // "01"
  readonly slug: string;
  readonly name: string;
  readonly goal: string;
  readonly pre_seeded?: boolean;
  readonly gathered?: string;
}

export async function writePhaseContext(opts: WritePhaseContextOptions): Promise<string> {
  const path = join(
    opts.planningDir,
    'phases',
    `${opts.position}-${opts.slug}`,
    `${opts.position}-CONTEXT.md`,
  );
  const gathered = opts.gathered ?? new Date().toISOString().slice(0, 10);
  const frontmatter = formatFrontmatter(
    {
      phase: opts.position,
      gathered,
      pre_seeded: opts.pre_seeded ?? false,
    },
    [
      `# Phase ${parseInt(opts.position, 10)}: ${opts.name}`,
      '',
      `**Goal:** ${opts.goal}`,
      '',
      '## Notes',
      '',
      '_(no discussion notes yet)_',
      '',
    ].join('\n'),
  );
  await writeAtomically(path, frontmatter);
  return path;
}

export interface WriteMilestoneContextOptions {
  readonly planningDir: string;
  readonly milestone_name: string;
  readonly scope_boundary: string;
  readonly decomposition_rationale: string;
  readonly requirement_mapping?: readonly { phase: string; reqs: readonly string[] }[];
  readonly key_decisions?: readonly { decision: string; rationale: string }[];
  readonly deferred_ideas?: readonly string[];
  readonly gathered?: string;
}

export async function writeMilestoneContext(
  opts: WriteMilestoneContextOptions,
): Promise<string> {
  const path = join(opts.planningDir, 'CONTEXT.md');
  const gathered = opts.gathered ?? new Date().toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(`# ${opts.milestone_name}`);
  lines.push('');
  lines.push(`**Gathered:** ${gathered}`);
  lines.push('');
  lines.push('## Scope Boundary');
  lines.push('');
  lines.push(opts.scope_boundary.trim());
  lines.push('');
  lines.push('## Decomposition Decisions');
  lines.push('');
  lines.push(opts.decomposition_rationale.trim());
  lines.push('');
  if (opts.requirement_mapping !== undefined && opts.requirement_mapping.length > 0) {
    lines.push('## Requirement Mapping');
    lines.push('');
    for (const m of opts.requirement_mapping) {
      lines.push(`- Phase ${m.phase}: ${m.reqs.join(', ')}`);
    }
    lines.push('');
  }
  if (opts.key_decisions !== undefined && opts.key_decisions.length > 0) {
    lines.push('## Key Decisions');
    lines.push('');
    for (const d of opts.key_decisions) {
      lines.push(`- **${d.decision}** — ${d.rationale}`);
    }
    lines.push('');
  }
  if (opts.deferred_ideas !== undefined && opts.deferred_ideas.length > 0) {
    lines.push('## Deferred Ideas');
    lines.push('');
    for (const idea of opts.deferred_ideas) {
      lines.push(`- ${idea}`);
    }
    lines.push('');
  }

  await writeAtomically(path, lines.join('\n'));
  return path;
}
