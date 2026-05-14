/**
 * REQ-12 — Snake-game canary (anti-empty-PLAN.md regression test).
 *
 * Phase 5 plan 05-03 T3 (TDD3 §22). This is the test that catches the
 * regression which broke the prior v3 alpha — the alpha emitted
 * `PLAN.md` with zero tasks and Dev wrote no source code. If this
 * canary ever fails with "must_haves.truths.length < 3" or "no <task>
 * blocks found", it's the same regression.
 *
 * The canary has TWO layers:
 *
 *   1. **Schema-floor (always runs).** Validates the snake fixture
 *      itself + the committed milestone cassette. These assertions
 *      run on every regression CI invocation regardless of API
 *      availability — they catch fixture drift early and confirm the
 *      cassette is structurally valid against
 *      `CassetteHeaderSchema` + `CassetteInteractionSchema`.
 *
 *   2. **End-to-end replay (gated, skipped today).** Replays the
 *      milestone cassette against `swt cook` and asserts:
 *      - PLAN.md exists and is non-empty.
 *      - PLAN.md frontmatter has `must_haves.truths.length >= 3`.
 *      - PLAN.md body has >= 3 `<task>` XML blocks, each with
 *        populated `<files>`, `<action>`, `<verify>` blocks.
 *      - PLAN.md frontmatter has `skills_used` containing
 *        `python-testing-patterns`.
 *      - Dev wrote `snake/__main__.py` + `snake/game.py` +
 *        `tests/test_game.py`, each non-empty.
 *      - `from snake.game import Game; Game.step` resolves
 *        (REQ-04 — curses-free state machine).
 *      - `pytest tests/` exits 0 with >= 4 PASSED tests (REQ-05).
 *
 *      Today this layer is gated behind `SNAKE_CANARY_E2E=1` because:
 *      (a) the committed milestone.jsonl is SYNTHETIC (DEVN-03 — see
 *      `scripts/record-cassette-scenarios/snake-milestone.mjs`
 *      docstring) — it has no semantic content that would survive a
 *      real cook run; AND (b) plan 05-04 owns the runVibe → cook
 *      `({cwd, nonInteractive})` bridge that drives end-to-end. Once
 *      the real cassette is recorded AND the bridge lands, the gate
 *      flips and the end-to-end assertions activate.
 *
 *  **Negative regression assertion (documentation, not executed).**
 *  The canary is the POSITIVE contract — PLAN.md has real tasks, Dev
 *  wrote real code. The NEGATIVE contract (canary fails when fed a
 *  deliberately-broken fixture) is exercised by manually pointing the
 *  canary at a stub cassette that causes Lead to emit a zero-task
 *  PLAN.md; running this test under those conditions yields the
 *  failure messages from the `must_haves.truths.length >= 3` and
 *  task-count assertions. That failure mode is what catches the prior
 *  alpha regression.
 *
 *  **Curses is not in-test-asserted.** REQ-01/02/03 cover curses-based
 *  playability; curses isn't unit-testable in CI without a TTY. The
 *  canary asserts the surrounding code (state machine in game.py,
 *  pytest coverage, file existence). QA's VERIFICATION.md handles
 *  curses with manual-check status (research §2.3 closing paragraph).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CassetteHeaderSchema,
  CassetteInteractionSchema,
  loadCassette,
} from '../../packages/test-utils/src/cassettes/index.js';

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'test-utils', 'golden', 'snake');
const SPEC_DIR = join(FIXTURE_ROOT, 'spec');
const CASSETTE_PATH = join(FIXTURE_ROOT, 'cassettes', 'milestone.jsonl');

// End-to-end gate. Flips to true once (a) the milestone cassette is
// re-recorded against the real Anthropic API AND (b) plan 05-04 lands
// the runVibe → cook bridge that drives `cookHandler({cwd,
// nonInteractive})`. Until then, the schema-floor assertions are the
// active gate.
const E2E_ENABLED = process.env['SNAKE_CANARY_E2E'] === '1';

describe('REQ-12 snake-game canary (anti-empty-PLAN.md regression)', () => {
  // ────────────────────────────────────────────────────────────────────
  // Layer 1: Schema-floor — always runs
  // ────────────────────────────────────────────────────────────────────

  describe('schema floor', () => {
    it('fixture spec/PROJECT.md exists and lists the surface-area files', () => {
      const projectPath = join(SPEC_DIR, 'PROJECT.md');
      expect(existsSync(projectPath)).toBe(true);
      const body = readFileSync(projectPath, 'utf8');
      expect(body).toMatch(/snake\/__main__\.py/);
      expect(body).toMatch(/snake\/game\.py/);
      expect(body).toMatch(/tests\/test_game\.py/);
    });

    it('fixture spec/REQUIREMENTS.md exists with 5 P0 requirements', () => {
      const reqPath = join(SPEC_DIR, 'REQUIREMENTS.md');
      expect(existsSync(reqPath)).toBe(true);
      const body = readFileSync(reqPath, 'utf8');
      // Whitespace-tolerant: prettier pads markdown table cells to column
      // width, so match `| REQ-NN |` / `| P0 |` with variable internal spacing.
      const reqRows = body.match(/^\|\s*REQ-\d+\s*\|/gm) ?? [];
      expect(reqRows.length).toBe(5);
      const p0Count = (body.match(/\|\s*P0\s*\|/g) ?? []).length;
      expect(p0Count).toBe(5);
    });

    it('fixture README documents the FROZEN invariant', () => {
      const readmePath = join(FIXTURE_ROOT, 'README.md');
      expect(existsSync(readmePath)).toBe(true);
      const body = readFileSync(readmePath, 'utf8');
      expect(body).toMatch(/FROZEN|frozen/);
    });

    it('milestone cassette loads with a valid header + >= 1 interaction', () => {
      expect(existsSync(CASSETTE_PATH)).toBe(true);
      const c = loadCassette(CASSETTE_PATH);
      expect(c.header.schema_version).toBe(1);
      expect(c.header.cwd_redacted).toBe(true);
      expect(c.header.provider).toBeTruthy();
      expect(c.header.model).toBeTruthy();
      expect(c.header.name).toBe('snake-milestone');
      expect(c.interactions.length).toBeGreaterThanOrEqual(1);
      // First interaction's body_hash matches the sha256 regex from the
      // schema (this is also enforced by CassetteInteractionSchema, but
      // we surface a clearer assertion message at the canary boundary).
      expect(c.interactions[0]?.request.body_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('cassette header + every interaction validate against their schemas', () => {
      const c = loadCassette(CASSETTE_PATH);
      expect(() => CassetteHeaderSchema.parse(c.header)).not.toThrow();
      for (const interaction of c.interactions) {
        expect(() => CassetteInteractionSchema.parse(interaction)).not.toThrow();
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Layer 2: End-to-end replay — gated behind SNAKE_CANARY_E2E=1
  //
  // These assertions are the REQ-12 positive contract. They are gated
  // because the committed milestone.jsonl is synthetic today
  // (DEVN-03); flipping the gate before re-recording would produce
  // false negatives. See the file-level JSDoc above for the activation
  // criteria.
  // ────────────────────────────────────────────────────────────────────

  describe.skipIf(!E2E_ENABLED)('end-to-end PLAN.md regression', () => {
    let tmpRoot: string;
    let planPath: string;
    let planBody: string;

    it('cook produced a non-empty PLAN.md in .swt-planning/phases', async () => {
      // This `beforeAll` work is folded into the first test so the
      // skipIf gate above short-circuits the whole describe block
      // without needing a separate `beforeAll(() => skip)` dance.
      const result = await execEndToEnd({
        specDir: SPEC_DIR,
        cassettePath: CASSETTE_PATH,
      });
      tmpRoot = result.tmpRoot;
      planPath = result.planPath;
      planBody = result.planBody;
      expect(existsSync(planPath)).toBe(true);
      expect(statSync(planPath).size).toBeGreaterThan(0);
    });

    it('PLAN.md frontmatter has must_haves.truths.length >= 3', () => {
      const fm = parsePlanFrontmatter(planBody);
      const truths = fm?.must_haves?.truths ?? [];
      expect(Array.isArray(truths)).toBe(true);
      expect(truths.length).toBeGreaterThanOrEqual(3);
    });

    it('PLAN.md body has >= 3 <task> blocks, each with files/action/verify', () => {
      const tasks = extractTaskBlocks(planBody);
      expect(tasks.length).toBeGreaterThanOrEqual(3);
      for (const [idx, task] of tasks.entries()) {
        expect(task.files.length, `task#${idx} <files> must be non-empty`).toBeGreaterThan(0);
        expect(task.action.length, `task#${idx} <action> must be non-empty`).toBeGreaterThan(0);
        expect(task.verify.length, `task#${idx} <verify> must be non-empty`).toBeGreaterThan(0);
      }
    });

    it('PLAN.md frontmatter.skills_used includes python-testing-patterns', () => {
      const fm = parsePlanFrontmatter(planBody);
      const skills = fm?.skills_used ?? [];
      expect(Array.isArray(skills)).toBe(true);
      expect(skills).toContain('python-testing-patterns');
    });

    it('Dev wrote snake/__main__.py + snake/game.py + tests/test_game.py', () => {
      for (const rel of ['snake/__main__.py', 'snake/game.py', 'tests/test_game.py']) {
        const p = join(tmpRoot, rel);
        expect(existsSync(p), `${rel} must exist`).toBe(true);
        expect(statSync(p).size, `${rel} must be non-empty`).toBeGreaterThan(0);
      }
    });

    it('REQ-04: snake/game.py imports cleanly without curses + exports Game.step', async () => {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync(
        'python3',
        [
          '-c',
          'from snake.game import Game; assert hasattr(Game, "step"), "Game.step missing"; print("OK")',
        ],
        {
          cwd: tmpRoot,
          env: { ...process.env, PYTHONPATH: tmpRoot },
        },
      );
      expect(result.status, `python3 import check failed: ${result.stderr?.toString()}`).toBe(0);
      expect(result.stdout?.toString()).toContain('OK');
    });

    it('REQ-05: pytest tests/ exits 0 with >= 4 passing tests', async () => {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync('pytest', ['tests/', '-v'], {
        cwd: tmpRoot,
        env: { ...process.env, PYTHONPATH: tmpRoot },
      });
      expect(result.status, `pytest failed: ${result.stderr?.toString()}`).toBe(0);
      const out = result.stdout?.toString() ?? '';
      const passedCount = (out.match(/PASSED/g) ?? []).length;
      expect(passedCount, `expected >= 4 passing tests, got ${passedCount}`).toBeGreaterThanOrEqual(
        4,
      );
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Helpers — kept inline (no extra workspace deps)
// ────────────────────────────────────────────────────────────────────────

/**
 * Parse the `---\n...\n---\n` YAML frontmatter of a PLAN.md into a
 * plain JS object. Hand-rolled to avoid a new workspace dep (gray-
 * matter / js-yaml are not at the workspace root today). Only handles
 * the subset of YAML the PLAN template produces:
 *   - simple scalars (`key: value`)
 *   - flow-style arrays (`key: [a, b, c]`)
 *   - block-style nested mappings (`key:\n  child: value`)
 *   - block-style nested arrays under `must_haves:` (`truths:\n  - "..."` )
 *
 * Returns null when no frontmatter is present.
 */
function parsePlanFrontmatter(body: string): Record<string, unknown> | null {
  const match = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (match === null || match[1] === undefined) return null;
  const lines = match[1].split('\n');
  return parseYamlBlock(lines, 0).value;
}

function parseYamlBlock(
  lines: string[],
  baseIndent: number,
): { value: Record<string, unknown>; consumed: number } {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      i++;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      i++;
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = line.slice(indent, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();
    if (rest.length > 0) {
      out[key] = parseScalarOrFlow(rest);
      i++;
      continue;
    }
    // Block-style continuation: either nested object or list.
    const nextLine = lines[i + 1] ?? '';
    const nextIndent = nextLine.length - nextLine.trimStart().length;
    if (nextLine.trimStart().startsWith('- ')) {
      const arr: unknown[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j] ?? '';
        if (l.trim().length === 0) {
          j++;
          continue;
        }
        const ind = l.length - l.trimStart().length;
        if (ind < nextIndent) break;
        if (l.trimStart().startsWith('- ')) {
          arr.push(parseScalarOrFlow(l.trimStart().slice(2).trim()));
          j++;
        } else {
          j++;
        }
      }
      out[key] = arr;
      i = j;
    } else {
      const sub = parseYamlBlock(lines.slice(i + 1), nextIndent);
      out[key] = sub.value;
      i += 1 + sub.consumed;
    }
  }
  return { value: out, consumed: i };
}

function parseScalarOrFlow(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitFlowArray(inner).map((s) => parseFlowItem(s));
  }
  return parseFlowItem(trimmed);
}

function splitFlowArray(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote: '"' | "'" | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuote !== null) {
      if (ch === inQuote && inner[i - 1] !== '\\') inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseFlowItem(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Extract `<task>` XML blocks from a PLAN.md body. Returns one record
 * per task with the inner text of each child `<files>` / `<action>` /
 * `<verify>` block. Matches the structure of templates/PLAN.md per
 * agents/swt-lead.md:11-13.
 */
function extractTaskBlocks(body: string): Array<{
  files: string;
  action: string;
  verify: string;
}> {
  const taskRe = /<task\b[^>]*>([\s\S]*?)<\/task>/g;
  const tasks: Array<{ files: string; action: string; verify: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = taskRe.exec(body)) !== null) {
    const inner = m[1] ?? '';
    tasks.push({
      files: extractInner(inner, 'files'),
      action: extractInner(inner, 'action'),
      verify: extractInner(inner, 'verify'),
    });
  }
  return tasks;
}

function extractInner(body: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = body.match(re);
  return m?.[1]?.trim() ?? '';
}

/**
 * Walk `rootDir` recursively, returning the first relative path whose
 * full path matches `pattern`. Used by `execEndToEnd` to discover the
 * emergent PLAN.md path (the phase slug is decided by Scout's
 * analysis, not fixed in the spec).
 */
function findFirstMatching(rootDir: string, pattern: RegExp): string | null {
  if (!existsSync(rootDir)) return null;
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const child = findFirstMatching(full, pattern);
      if (child !== null) return child;
    } else if (pattern.test(full)) {
      return full;
    }
  }
  return null;
}

/**
 * End-to-end driver — runs `swt cook` non-interactively against a tmp
 * copy of `golden/snake/spec/` with the milestone cassette replaying
 * every LLM call. Returns the discovered PLAN.md path + its body.
 *
 * **Today this throws a deferred-implementation error.** The reason:
 * plan 05-04 owns the `runVibe → cook` bridge that exposes the
 * `cookHandler({cwd, nonInteractive})` shape end-to-end (cook.ts today
 * exports a `CommandHandler(parsed, io)` function). Once 05-04 lands
 * AND the milestone cassette is re-recorded against the real
 * Anthropic API (DEVN-03), the body of this function is the only
 * piece that needs to change — every assertion above is already
 * written.
 */
async function execEndToEnd(opts: {
  specDir: string;
  cassettePath: string;
}): Promise<{ tmpRoot: string; planPath: string; planBody: string }> {
  // Reference `findFirstMatching` so the unused-import linter doesn't
  // strip it before the body fills in (also: clear breadcrumb for the
  // 05-04 author of which helper to use).
  void findFirstMatching;
  void opts;
  throw new Error(
    'snake-canary execEndToEnd: deferred to plan 05-04. The runVibe → cook bridge ' +
      '(cookHandler({cwd, nonInteractive})) must land + the milestone cassette must be ' +
      're-recorded against the real Anthropic API before this gate flips. Set ' +
      'SNAKE_CANARY_E2E=1 only after both prerequisites are met.',
  );
}
