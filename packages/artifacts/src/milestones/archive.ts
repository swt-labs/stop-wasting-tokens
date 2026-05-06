import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeAtomically } from '../atomic-write.js';
import { parseState } from '../state/updater.js';

export interface ArchiveMilestoneOptions {
  readonly planningDir: string;
  /** Milestone slug — used as the directory under milestones/. */
  readonly slug: string;
  /** Optional ISO timestamp; defaults to now. */
  readonly archived_at?: string;
}

export interface ArchiveMilestoneResult {
  readonly milestoneDir: string;
  readonly shippedFile: string;
}

/**
 * Move ROADMAP.md and phases/ under `<planningDir>/milestones/<slug>/`. Read
 * the current STATE.md, archive its current-phase + activity-log sections to
 * the milestone copy, and rewrite the root STATE.md preserving project-level
 * sections (Todos, Decisions, Blockers, Codebase Profile).
 */
export async function archiveMilestone(
  opts: ArchiveMilestoneOptions,
): Promise<ArchiveMilestoneResult> {
  const milestoneDir = join(opts.planningDir, 'milestones', opts.slug);
  await mkdir(milestoneDir, { recursive: true });

  await renameIfExists(
    join(opts.planningDir, 'ROADMAP.md'),
    join(milestoneDir, 'ROADMAP.md'),
  );
  await renameIfExists(
    join(opts.planningDir, 'phases'),
    join(milestoneDir, 'phases'),
  );

  // Archive STATE.md to the milestone, then rewrite the root STATE.md
  // preserving project-level sections only.
  const stateFromRoot = join(opts.planningDir, 'STATE.md');
  const archivedState = join(milestoneDir, 'STATE.md');
  let project: string | undefined;
  let preserved: { todos: string; decisions: string; blockers: string } = {
    todos: '',
    decisions: '',
    blockers: '',
  };
  try {
    const raw = await readFile(stateFromRoot, 'utf8');
    await writeFile(archivedState, raw, 'utf8');
    const parsed = parseState(raw);
    project = parsed.project;
    preserved = {
      todos: sectionByHeading(parsed, 'Todos'),
      decisions: sectionByHeading(parsed, 'Key Decisions'),
      blockers: sectionByHeading(parsed, 'Blockers'),
    };
  } catch (err) {
    if (
      typeof err !== 'object' ||
      err === null ||
      (err as { code?: string }).code !== 'ENOENT'
    ) {
      throw err;
    }
  }

  const newState = renderRootState(project ?? 'unknown', preserved);
  await writeAtomically(stateFromRoot, newState);

  const shippedFile = join(milestoneDir, 'SHIPPED.md');
  const archivedAt = opts.archived_at ?? new Date().toISOString();
  await writeFile(
    shippedFile,
    [
      `# ${opts.slug}`,
      '',
      `Shipped: ${archivedAt}`,
      '',
      `Project: ${project ?? 'unknown'}`,
      '',
    ].join('\n'),
    'utf8',
  );

  return { milestoneDir, shippedFile };
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if (
      typeof err !== 'object' ||
      err === null ||
      (err as { code?: string }).code !== 'ENOENT'
    ) {
      throw err;
    }
  }
}

function sectionByHeading(
  parsed: ReturnType<typeof parseState>,
  heading: string,
): string {
  return parsed.sections.find((s) => s.heading === heading)?.body ?? '';
}

function renderRootState(
  project: string,
  preserved: { todos: string; decisions: string; blockers: string },
): string {
  const lines: string[] = [];
  lines.push('# State');
  lines.push('');
  lines.push(`**Project:** ${project}`);
  lines.push('');
  lines.push('## Key Decisions');
  lines.push(preserved.decisions.length > 0 ? preserved.decisions : '_(no decisions)_');
  lines.push('');
  lines.push('## Todos');
  lines.push(preserved.todos.length > 0 ? preserved.todos : '_(none)_');
  lines.push('');
  lines.push('## Blockers');
  lines.push(preserved.blockers.length > 0 ? preserved.blockers : '_(none)_');
  lines.push('');
  return lines.join('\n');
}
