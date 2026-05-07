/**
 * Minimal TOML emitter. Covers scalars (string, number, boolean), arrays of
 * scalars, nested inline tables, and standard table headers. Sufficient for
 * Codex agent / permission / config writes; not a general-purpose TOML
 * library.
 */

export type TomlValue =
  | string
  | number
  | boolean
  | readonly TomlValue[]
  | { readonly [key: string]: TomlValue };

const KEY_RE = /^[A-Za-z0-9_-]+$/;

function emitKey(key: string): string {
  return KEY_RE.test(key) ? key : `"${key.replace(/"/g, '\\"')}"`;
}

function emitString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function emitScalar(value: string | number | boolean): string {
  if (typeof value === 'string') return emitString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot emit non-finite number: ${String(value)}`);
    }
    return String(value);
  }
  return value ? 'true' : 'false';
}

function isTomlArray(value: TomlValue): value is readonly TomlValue[] {
  return Array.isArray(value);
}

function isInlineTable(value: TomlValue): value is { readonly [key: string]: TomlValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emitInlineValue(value: TomlValue): string {
  if (isTomlArray(value)) {
    return `[${value.map((v) => emitInlineValue(v)).join(', ')}]`;
  }
  if (isInlineTable(value)) {
    const entries = Object.entries(value).map(([k, v]) => `${emitKey(k)} = ${emitInlineValue(v)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return emitScalar(value);
}

function emitTable(prefix: string, table: Record<string, TomlValue>): string[] {
  const lines: string[] = [];
  if (prefix.length > 0) lines.push(`[${prefix}]`);

  const subTables: [string, Record<string, TomlValue>][] = [];

  for (const [key, value] of Object.entries(table)) {
    if (
      isInlineTable(value) &&
      Object.values(value).some((v) => isInlineTable(v) || Array.isArray(v))
    ) {
      // Promote complex sub-objects to nested table headers.
      subTables.push([key, value]);
      continue;
    }
    lines.push(`${emitKey(key)} = ${emitInlineValue(value)}`);
  }

  for (const [key, sub] of subTables) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    const nestedPrefix = prefix.length > 0 ? `${prefix}.${emitKey(key)}` : emitKey(key);
    for (const line of emitTable(nestedPrefix, sub)) lines.push(line);
  }

  return lines;
}

export function emitToml(table: Record<string, TomlValue>): string {
  const lines = emitTable('', table);
  if (lines.length === 0 || lines[lines.length - 1] !== '') lines.push('');
  return lines.join('\n');
}
