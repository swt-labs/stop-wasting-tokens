/**
 * `swt migrate --to=v3` — v2 → v3 `.swt-planning/` migration per TDD2 §13.6.1
 * + Plan 06-01 PR-49.
 *
 * Walks a v2-vintage planning directory + emits a v3-shaped copy with:
 *
 *   1. `backend: 'codex' | 'claude-code' | 'ollama'` → `backend: 'pi'` (per ADR-005 + M6 PR-45)
 *   2. `agent_backend: 'codex' | 'scripted'` → `agent_backend: 'pi'` (per M6 PR-45)
 *   3. `reasoning_effort: <CodexReasoningEffort>` → `thinking_level: <ThinkingLevel>` (per ADR-002)
 *      Mapping: low → low, medium → medium, high → high. The Pi-native
 *      `off | minimal | xhigh` values are introduced fresh in v3; they're
 *      never present in v2 artefacts.
 *
 * Everything else — `PROJECT.md`, `REQUIREMENTS.md`, milestone phases +
 * plans + summaries, the journal, the lock files — passes through
 * verbatim. The methodology is unchanged between v2 and v3 (ADR §13.6
 * Principle 2); the migration is purely a vocabulary refresh.
 *
 * **Idempotent.** Running `swt migrate --to=v3` on an already-v3
 * directory is a no-op (or rather: rewrites zero fields). The
 * migration report's `fields_rewritten` count reads `0` in that case.
 *
 * **Out-of-place.** Reads from `--input`, writes to `--output`. The
 * input directory is never touched. This is the only safe contract
 * for a migration that operators run against their real project
 * `.swt-planning/`.
 *
 * Exit codes:
 *   0 — migration complete; report printed to stdout
 *   1 — `EXIT.USAGE_ERROR`: missing `--input` or `--output`
 *   2 — `EXIT.NOT_IMPLEMENTED`: `--input` directory doesn't exist
 *   3 — `EXIT.RUNTIME_ERROR`: unexpected fs / parse error mid-migration
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export interface MigrateReport {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly files_scanned: number;
  readonly fields_rewritten: number;
  readonly notes: ReadonlyArray<string>;
}

interface MigrateOptions {
  readonly input: string;
  readonly output: string;
}

const LEGACY_BACKENDS = new Set(['codex', 'claude-code', 'ollama']);
const LEGACY_AGENT_BACKENDS = new Set(['codex', 'scripted']);

export const migrateHandler: CommandHandler = (parsed, io: CommandIO): ExitCode => {
  const opts = resolveOptions(parsed.flags);
  if (opts === null) {
    io.stderr.write(
      'swt migrate: usage: swt migrate --to=v3 --input <v2-planning-dir> --output <v3-planning-dir>\n',
    );
    return EXIT.USAGE_ERROR;
  }
  const absInput = isAbsolute(opts.input) ? opts.input : resolve(io.cwd, opts.input);
  const absOutput = isAbsolute(opts.output) ? opts.output : resolve(io.cwd, opts.output);
  if (!existsSync(absInput) || !statSync(absInput).isDirectory()) {
    io.stderr.write(`swt migrate: input directory does not exist: ${opts.input}\n`);
    return EXIT.NOT_IMPLEMENTED;
  }

  try {
    // 1. Copy the whole tree out-of-place so the input directory is
    // never mutated. The migration then rewrites in the output copy.
    mkdirSync(absOutput, { recursive: true });
    cpSync(absInput, absOutput, { recursive: true });

    // 2. Walk the output tree; rewrite *.json + *.md files in place.
    const report = walkAndRewrite(absOutput);

    io.stdout.write(
      `swt migrate --to=v3: complete.\n` +
        `  Input:  ${opts.input}\n` +
        `  Output: ${opts.output}\n` +
        `  Files scanned: ${report.files_scanned}\n` +
        `  Fields rewritten: ${report.fields_rewritten}\n` +
        (report.notes.length > 0
          ? report.notes.map((n) => `  - ${n}\n`).join('')
          : '  (No notes.)\n'),
    );
    return EXIT.SUCCESS;
  } catch (err) {
    io.stderr.write(
      `swt migrate: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return EXIT.RUNTIME_ERROR;
  }
};

function resolveOptions(
  flags: Readonly<Record<string, string | boolean | undefined>>,
): MigrateOptions | null {
  // `--to=v3` is enforced syntactically — only the v3 target is supported.
  const to = stringFlag(flags['to']);
  if (to !== undefined && to !== 'v3') return null;
  const input = stringFlag(flags['input']);
  const output = stringFlag(flags['output']);
  if (input === undefined || output === undefined) return null;
  return { input, output };
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

interface WalkAccumulator {
  files_scanned: number;
  fields_rewritten: number;
  notes: string[];
}

function walkAndRewrite(root: string): MigrateReport {
  const acc: WalkAccumulator = { files_scanned: 0, fields_rewritten: 0, notes: [] };
  walkDir(root, root, acc);
  return {
    inputDir: root,
    outputDir: root,
    files_scanned: acc.files_scanned,
    fields_rewritten: acc.fields_rewritten,
    notes: acc.notes,
  };
}

function walkDir(absDir: string, root: string, acc: WalkAccumulator): void {
  const entries = readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walkDir(absPath, root, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    acc.files_scanned += 1;
    const relPath = relative(root, absPath);
    if (entry.name.endsWith('.json')) {
      rewriteJsonFile(absPath, relPath, acc);
    } else if (entry.name.endsWith('.md')) {
      rewriteMarkdownFrontmatter(absPath, relPath, acc);
    }
  }
}

function rewriteJsonFile(absPath: string, relPath: string, acc: WalkAccumulator): void {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // skip non-JSON (could be a comment-bearing JSON5 or invalid)
  }
  let mutations = 0;
  mutations += rewriteBackendFields(parsed);
  if (mutations === 0) return;
  acc.fields_rewritten += mutations;
  acc.notes.push(`${relPath}: rewrote ${mutations} field(s)`);
  writeFileSync(absPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

/**
 * Walks the JSON value recursively. Whenever we see a key matching
 * `backend` / `agent_backend` whose value is a legacy enum string,
 * rewrite to `'pi'`. Returns the count of rewrites.
 */
function rewriteBackendFields(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    let n = 0;
    for (const item of value) n += rewriteBackendFields(item);
    return n;
  }
  const obj = value as Record<string, unknown>;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'backend' && typeof v === 'string' && LEGACY_BACKENDS.has(v)) {
      obj[k] = 'pi';
      n += 1;
    } else if (k === 'agent_backend' && typeof v === 'string' && LEGACY_AGENT_BACKENDS.has(v)) {
      obj[k] = 'pi';
      n += 1;
    } else if (typeof v === 'object' && v !== null) {
      n += rewriteBackendFields(v);
    }
  }
  return n;
}

/**
 * Markdown frontmatter rewrite: `reasoning_effort: X` → `thinking_level: X`
 * on a top-level YAML frontmatter block. v3 introduces additional Pi-native
 * values (`off | minimal | xhigh`) but v2 artefacts only have low/medium/high,
 * which carry over identically.
 *
 * Deliberately simple: regex-based on the frontmatter block. Markdown body
 * is never touched.
 */
function rewriteMarkdownFrontmatter(absPath: string, relPath: string, acc: WalkAccumulator): void {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  // Only inspect files that have a leading `---\n` frontmatter delimiter.
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return;
  const closeIdx = raw.indexOf('\n---\n', 4);
  if (closeIdx < 0) return;
  const frontmatter = raw.slice(0, closeIdx + 5);
  const body = raw.slice(closeIdx + 5);

  // Rewrite `reasoning_effort:` keys. Tolerate leading whitespace.
  const rewritten = frontmatter.replace(/^([ \t]*)reasoning_effort:/gm, '$1thinking_level:');
  if (rewritten === frontmatter) return;
  // Count the number of replacements (lines that changed).
  const mutations = (frontmatter.match(/^[ \t]*reasoning_effort:/gm) ?? []).length;
  acc.fields_rewritten += mutations;
  acc.notes.push(`${relPath}: renamed ${mutations} frontmatter field(s)`);
  writeFileSync(absPath, rewritten + body, 'utf8');
}
