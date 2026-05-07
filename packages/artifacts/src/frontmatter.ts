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
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) {
      i += 1;
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i += 1;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (value.length === 0) {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        const trimmed = next.trim();
        if (trimmed.length === 0) {
          j += 1;
          continue;
        }
        if (next.startsWith('  - ') || next.startsWith('- ')) {
          items.push(unquote(trimmed.slice(2).trim()));
          j += 1;
          continue;
        }
        break;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
        continue;
      }
      out[key] = '';
      i += 1;
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (inner.startsWith('{')) {
        try {
          out[key] = JSON.parse(value) as unknown;
          i += 1;
          continue;
        } catch {
          // fall through to the string-array path
        }
      }
      out[key] = inner
        .split(',')
        .map((s) => s.trim())
        .map((s) => unquote(s))
        .filter((s) => s.length > 0);
      i += 1;
      continue;
    }

    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        out[key] = JSON.parse(value) as unknown;
        i += 1;
        continue;
      } catch {
        // fall through to plain-string handling
      }
    }

    if (value === 'true') {
      out[key] = true;
      i += 1;
      continue;
    }
    if (value === 'false') {
      out[key] = false;
      i += 1;
      continue;
    }
    if (/^-?\d+$/.test(value)) {
      out[key] = Number.parseInt(value, 10);
      i += 1;
      continue;
    }

    out[key] = unquote(value);
    i += 1;
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
      if (value.some((item) => typeof item === 'object' && item !== null)) {
        lines.push(`${key}: ${JSON.stringify(value)}`);
        continue;
      }
      const items = value
        .map((item) => (typeof item === 'string' ? JSON.stringify(item) : String(item)))
        .join(', ');
      lines.push(`${key}: [${items}]`);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      lines.push(`${key}: ${String(value)}`);
      continue;
    }
    // Fallback for any other shape (bigint, symbol, etc) — JSON stringify it.
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * Safely stringify an unknown frontmatter value for inclusion in user-facing
 * messages or paths. Returns `''` for objects, arrays, and other non-scalar
 * values rather than the meaningless `[object Object]`. Strings, numbers,
 * and booleans are stringified normally.
 */
export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
