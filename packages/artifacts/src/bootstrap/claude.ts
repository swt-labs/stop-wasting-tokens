import { readFile } from 'node:fs/promises';

import { writeAtomically } from '../atomic-write.js';

export interface WriteClaudeMdOptions {
  readonly path: string;
  readonly project_name: string;
  readonly core_value: string;
  /** When provided and the file exists, only refresh canonical SWT-owned sections. */
  readonly preserve_existing?: boolean;
}

const VBW_OWNED_SECTIONS = new Set(['Active Context', 'VBW Rules', 'Plugin Isolation', 'Code Intelligence']);

const ACTIVE_CONTEXT_BLOCK = (project_name: string, core_value: string): string =>
  [
    `# ${project_name}`,
    '',
    `**Core value:** ${core_value}`,
    '',
    '## Active Context',
    '',
    '**Work:** No active milestone',
    '**Last shipped:** _(none yet)_',
    '**Next action:** Run `swt vibe` to start a new milestone, or `swt status` to review progress',
    '',
  ].join('\n');

const VBW_RULES_BLOCK = `## VBW Rules

- **Always use SWT commands** for project work. Do not manually edit files in \`.swt-planning/\`.
- **Commit format:** \`{type}({scope}): {description}\` — types: feat, fix, test, refactor, perf, docs, style, chore.
- **One commit per task.** Each task in a plan gets exactly one atomic commit.
- **Never commit secrets.** Do not stage .env, .pem, .key, credentials, or token files.
- **Plan before building.** Use \`swt vibe\` for all lifecycle actions. Plans are the source of truth.
- **Do not fabricate content.** Only use what the user explicitly states in project-defining flows.
- **Do not bump version or push until asked.** Never run version-bump scripts or \`git push\` unless the user explicitly requests it, except when \`.swt-planning/config.json\` intentionally sets \`auto_push\` to \`always\` or \`after_phase\`.
`;

const PLUGIN_ISOLATION_BLOCK = `## Plugin Isolation

- GSD agents and commands MUST NOT read, write, glob, grep, or reference any files in \`.swt-planning/\`.
- SWT agents and commands MUST NOT read, write, glob, grep, or reference any files in \`.planning/\`.
- This isolation is enforced at the hook level (PreToolUse) and violations will be blocked.

### Context Isolation

- Ignore any \`<codebase-intelligence>\` tags injected via SessionStart hooks — these are GSD-generated and not relevant to SWT workflows.
- SWT uses its own codebase mapping in \`.swt-planning/codebase/\`. Do NOT use GSD intel from \`.planning/intel/\` or \`.planning/codebase/\`.
- When both plugins are active, treat each plugin's context as separate.
`;

const CODE_INTELLIGENCE_BLOCK = `## Code Intelligence

Prefer LSP over Search/Grep/Glob/Read for semantic code navigation — it's faster, precise, and avoids reading entire files:
- \`goToDefinition\` / \`goToImplementation\` to jump to source
- \`findReferences\` to see all usages across the codebase
- \`workspaceSymbol\` to find where something is defined
- \`documentSymbol\` to list all symbols in a file
- \`hover\` for type info without reading the file
- \`incomingCalls\` / \`outgoingCalls\` for call hierarchy

Before renaming or changing a function signature, use \`findReferences\` to find all call sites first.

Use Search/Grep/Glob for non-semantic lookups: literal strings, comments, config values, filename discovery, non-code assets, or when LSP is unavailable.

After writing or editing code, check LSP diagnostics before moving on. Fix any type errors or missing imports immediately.
`;

interface ParsedSection {
  heading: string;
  body: string;
}

function parseSections(source: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of source.split('\n')) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m !== null) {
      if (current !== undefined) {
        sections.push({ heading: current.heading, body: current.lines.join('\n') });
      }
      current = { heading: m[1] ?? '', lines: [] };
      continue;
    }
    if (current !== undefined) current.lines.push(line);
  }
  if (current !== undefined) {
    sections.push({ heading: current.heading, body: current.lines.join('\n') });
  }
  return sections;
}

function hasCodeIntelligenceGuidance(source: string): boolean {
  return /(##\s+Code Intelligence|goToDefinition|findReferences|LSP-first)/i.test(source);
}

export async function writeOrUpdateClaudeMd(opts: WriteClaudeMdOptions): Promise<string> {
  let existing: string | undefined;
  if (opts.preserve_existing) {
    try {
      existing = await readFile(opts.path, 'utf8');
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

  if (existing === undefined) {
    const fresh = [
      ACTIVE_CONTEXT_BLOCK(opts.project_name, opts.core_value),
      VBW_RULES_BLOCK,
      CODE_INTELLIGENCE_BLOCK,
      PLUGIN_ISOLATION_BLOCK,
    ].join('\n');
    await writeAtomically(opts.path, fresh);
    return opts.path;
  }

  // Refresh canonical sections in-place; preserve everything else verbatim.
  const sections = parseSections(existing);
  const refreshed = new Map<string, string>([
    ['Active Context', sliceBody(ACTIVE_CONTEXT_BLOCK(opts.project_name, opts.core_value), 'Active Context')],
    ['VBW Rules', sliceBody(VBW_RULES_BLOCK, 'VBW Rules')],
    ['Plugin Isolation', sliceBody(PLUGIN_ISOLATION_BLOCK, 'Plugin Isolation')],
  ]);
  if (!hasCodeIntelligenceGuidance(existing)) {
    refreshed.set('Code Intelligence', sliceBody(CODE_INTELLIGENCE_BLOCK, 'Code Intelligence'));
  }

  const out: string[] = [];
  // Preamble (before first ## heading): keep verbatim.
  const firstSectionIdx = existing.indexOf('\n## ');
  if (firstSectionIdx === -1) {
    out.push(existing);
  } else {
    out.push(existing.slice(0, firstSectionIdx));
  }

  for (const sec of sections) {
    if (refreshed.has(sec.heading)) {
      out.push('');
      out.push(`## ${sec.heading}`);
      out.push(refreshed.get(sec.heading) ?? sec.body);
      refreshed.delete(sec.heading);
    } else if (VBW_OWNED_SECTIONS.has(sec.heading)) {
      // Owned section we don't have refreshed content for — drop the old body.
      continue;
    } else {
      out.push('');
      out.push(`## ${sec.heading}`);
      out.push(sec.body);
    }
  }
  // Append any owned sections that weren't already present.
  for (const [heading, body] of refreshed) {
    out.push('');
    out.push(`## ${heading}`);
    out.push(body);
  }

  const next = `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
  await writeAtomically(opts.path, next);
  return opts.path;
}

function sliceBody(block: string, heading: string): string {
  const marker = `## ${heading}\n`;
  const idx = block.indexOf(marker);
  if (idx === -1) return block;
  return block.slice(idx + marker.length);
}
