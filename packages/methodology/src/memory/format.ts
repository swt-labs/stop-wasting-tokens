import type { MemoryEntry } from '@swt-labs/core';

const FRONTMATTER_FENCE = '---';

export interface ParsedTopicFile {
  readonly entry: MemoryEntry;
}

export function formatTopicFile(entry: MemoryEntry): string {
  const lines: string[] = [];
  lines.push(FRONTMATTER_FENCE);
  lines.push(`id: ${JSON.stringify(entry.id)}`);
  lines.push(`topic: ${JSON.stringify(entry.topic)}`);
  if (entry.created_at !== undefined) {
    lines.push(`created_at: ${JSON.stringify(entry.created_at)}`);
  }
  if (entry.tags !== undefined && entry.tags.length > 0) {
    lines.push(`tags: [${entry.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
  }
  lines.push(FRONTMATTER_FENCE);
  lines.push('');
  lines.push(entry.content.trim());
  lines.push('');
  return lines.join('\n');
}

export function parseTopicFile(content: string): ParsedTopicFile {
  if (!content.startsWith(FRONTMATTER_FENCE)) {
    throw new Error('Topic file is missing YAML frontmatter');
  }
  const end = content.indexOf(`\n${FRONTMATTER_FENCE}`, FRONTMATTER_FENCE.length);
  if (end === -1) {
    throw new Error('Topic file frontmatter is unterminated');
  }
  const fmBlock = content.slice(FRONTMATTER_FENCE.length, end).trim();
  const body = content
    .slice(end + FRONTMATTER_FENCE.length + 1)
    .replace(/^\n+/, '')
    .trim();

  const fields = parseScalarYaml(fmBlock);
  const id = fields.id;
  const topic = fields.topic;
  if (typeof id !== 'string' || typeof topic !== 'string') {
    throw new Error('Topic file frontmatter must include id and topic strings');
  }
  const tags = Array.isArray(fields.tags) ? (fields.tags as string[]) : undefined;
  const createdAt = typeof fields.created_at === 'string' ? fields.created_at : undefined;

  const entry: MemoryEntry = {
    id,
    topic,
    content: body,
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };
  return { entry };
}

export function formatIndex(entries: readonly MemoryEntry[]): string {
  const lines: string[] = [];
  lines.push('# MEMORY.md');
  lines.push('');
  lines.push(
    'Always-on lightweight index. Topic files live under `memory/<topic>.md`.',
  );
  lines.push('');
  lines.push('| ID | Topic | Tags |');
  lines.push('|----|-------|------|');
  for (const entry of entries) {
    const tags = entry.tags?.join(', ') ?? '';
    lines.push(`| ${entry.id} | ${entry.topic} | ${tags} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Tiny scalar-only YAML reader. Handles `key: "string"`, `key: bare`, and
 * `key: ["a", "b"]`. Sufficient for SWT topic-file frontmatter; full YAML
 * is intentionally out of scope.
 */
function parseScalarYaml(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s))
        .filter((s) => s.length > 0);
      continue;
    }
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}
