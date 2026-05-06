const FENCE = '---';

export interface ParsedDoc<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly frontmatter: T;
  readonly body: string;
}

/**
 * Parse a `---`-fenced YAML frontmatter block. Supports flat scalars,
 * inline arrays, and quoted strings. Multi-line scalars / nested objects
 * are intentionally out of scope — SWT only writes flat frontmatter.
 */
export function parseFrontmatter<T extends Record<string, unknown>>(
  source: string,
): ParsedDoc<T> {
  if (!source.startsWith(`${FENCE}\n`) && !source.startsWith(`${FENCE}\r\n`)) {
    return { frontmatter: {} as T, body: source };
  }
  const afterOpen = source.indexOf('\n') + 1;
  const closeIdx = source.indexOf(`\n${FENCE}`, afterOpen);
  if (closeIdx === -1) {
    return { frontmatter: {} as T, body: source };
  }
  const yamlBlock = source.slice(afterOpen, closeIdx);
  const bodyStart = closeIdx + FENCE.length + 1;
  const body = source.slice(bodyStart).replace(/^\n+/, '');
  return { frontmatter: parseScalarYaml(yamlBlock) as T, body };
}

export function formatFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const yaml = formatScalarYaml(frontmatter);
  if (yaml.length === 0) return body.endsWith('\n') ? body : `${body}\n`;
  const trimmedBody = body.replace(/^\n+/, '');
  const tail = trimmedBody.endsWith('\n') ? trimmedBody : `${trimmedBody}\n`;
  return `${FENCE}\n${yaml}${FENCE}\n\n${tail}`;
}

function parseScalarYaml(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    if (value.length === 0) {
      out[key] = '';
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .map((s) => unquote(s))
        .filter((s) => s.length > 0);
      continue;
    }

    if (value === 'true') {
      out[key] = true;
      continue;
    }
    if (value === 'false') {
      out[key] = false;
      continue;
    }
    if (/^-?\d+$/.test(value)) {
      out[key] = Number.parseInt(value, 10);
      continue;
    }

    out[key] = unquote(value);
  }
  return out;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function formatScalarYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const items = value
        .map((item) => (typeof item === 'string' ? JSON.stringify(item) : String(item)))
        .join(', ');
      lines.push(`${key}: [${items}]`);
      continue;
    }
    if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
