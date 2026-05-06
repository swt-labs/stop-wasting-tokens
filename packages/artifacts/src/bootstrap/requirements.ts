import { join } from 'node:path';

import { writeAtomically } from '../atomic-write.js';

import type { Discovery, InferredRequirement } from './discovery.js';

export interface WriteRequirementsOptions {
  readonly planningDir: string;
  readonly project_name: string;
  readonly core_value: string;
  readonly discovery: Discovery;
  /** ISO-8601 date string. Defaults to today. */
  readonly defined?: string;
  /** Optional research summary text injected at the top. */
  readonly research_summary?: string;
}

export async function writeRequirements(opts: WriteRequirementsOptions): Promise<string> {
  const path = join(opts.planningDir, 'REQUIREMENTS.md');
  const defined = opts.defined ?? new Date().toISOString().slice(0, 10);

  // Combine answered (string) + inferred (with priority).
  const answeredItems: InferredRequirement[] = opts.discovery.answered.map((text) => ({
    text,
    priority: 'must-have' as const,
  }));
  const allReqs = [...answeredItems, ...opts.discovery.inferred];

  const mustHaves = allReqs.filter((r) => r.priority === 'must-have');
  const niceToHaves = allReqs.filter((r) => r.priority === 'nice-to-have');
  const outOfScope = [
    ...allReqs.filter((r) => r.priority === 'out-of-scope').map((r) => r.text),
    ...opts.discovery.deferred,
  ];

  const lines: string[] = [];
  lines.push(`# ${opts.project_name} Requirements`);
  lines.push('');
  lines.push(`Defined: ${defined} | Core value: ${opts.core_value}`);
  lines.push('');

  if (opts.research_summary !== undefined && opts.research_summary.trim().length > 0) {
    lines.push('## Domain Context');
    lines.push('');
    lines.push(opts.research_summary.trim());
    lines.push('');
  }

  lines.push('## v1 Requirements');
  lines.push('');
  if (mustHaves.length === 0) {
    lines.push('_(none captured yet — run `swt vibe` to discuss)_');
  } else {
    lines.push('### Must-have');
    mustHaves.forEach((req, idx) => {
      const id = `REQ-${String(idx + 1).padStart(2, '0')}`;
      lines.push(`- [ ] **${id}**: ${req.text}`);
    });
  }
  lines.push('');

  if (niceToHaves.length > 0) {
    lines.push('### Nice-to-have');
    niceToHaves.forEach((req, idx) => {
      const id = `REQ-N${String(idx + 1).padStart(2, '0')}`;
      lines.push(`- [ ] **${id}**: ${req.text}`);
    });
    lines.push('');
  }

  lines.push('## v2 Requirements');
  lines.push('_(none yet)_');
  lines.push('');

  lines.push('## Out of Scope');
  if (outOfScope.length === 0) {
    lines.push('_(none yet)_');
  } else {
    outOfScope.forEach((text) => {
      lines.push(`- ${text}`);
    });
  }
  lines.push('');

  await writeAtomically(path, lines.join('\n'));
  return path;
}
