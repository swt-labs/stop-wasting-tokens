import { readFile } from 'node:fs/promises';

import { writeAtomically } from '../atomic-write.js';

export interface StateSection {
  readonly heading: string;
  readonly body: string;
}

export interface ParsedState {
  /** The full original content of STATE.md, kept verbatim. */
  readonly raw: string;
  /** Parsed `## Heading` sections in document order. */
  readonly sections: readonly StateSection[];
  /** Project name extracted from the `**Project:**` line, if present. */
  readonly project: string | undefined;
}

const PROJECT_LINE_RE = /^\*\*Project:\*\*\s*(.+)\s*$/m;

export function parseState(raw: string): ParsedState {
  const sections: StateSection[] = [];
  const lines = raw.split('\n');
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const match = /^##\s+(.*)$/.exec(line);
    if (match !== null) {
      if (current !== undefined) {
        sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      }
      current = { heading: match[1] ?? '', lines: [] };
      continue;
    }
    if (current !== undefined) current.lines.push(line);
  }
  if (current !== undefined) {
    sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  }
  const projectMatch = PROJECT_LINE_RE.exec(raw);
  return { raw, sections, project: projectMatch?.[1]?.trim() };
}

export async function readState(path: string): Promise<ParsedState | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    return parseState(raw);
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

export type StateMutator = (current: ParsedState | undefined) => string;

export async function updateState(path: string, mutator: StateMutator): Promise<void> {
  const current = await readState(path);
  const next = mutator(current);
  await writeAtomically(path, next.endsWith('\n') ? next : `${next}\n`);
}
