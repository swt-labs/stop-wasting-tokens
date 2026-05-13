/**
 * `diffArtefacts` — allowed-drift comparator for the v2 → v3 regression
 * suite per TDD2 §14.6.
 *
 * The regression suite asserts that running a v2-recorded scenario on
 * the v3 methodology produces byte-identical artefacts MODULO allowed
 * drift. The "allowed drift" rules per artefact category:
 *
 * | Artefact              | Allowed drift                                                              | Must match                                    |
 * | --------------------- | -------------------------------------------------------------------------- | --------------------------------------------- |
 * | STATE.md              | Activity-log timestamps (ISO 8601) on lines starting with `- YYYY-MM-DD`   | Phase summary text within Levenshtein ≤ 100   |
 * | phases/NN-slug/PLAN   | Task-ID prefixes (e.g. PR-XX numbering)                                    | Task content fingerprint (whitespace-stripped)|
 * | phases/NN-slug/QA     | Timestamps                                                                 | passed / failed / total counts exactly        |
 * | scout-briefs/         | Timestamps + LLM-generated phrasing                                        | Semantic fingerprint (URL + section headings) |
 * | debug-reports/        | Timestamps + LLM-generated phrasing                                        | Semantic fingerprint                          |
 * | Other .md files       | None (byte-exact match required)                                           | —                                             |
 *
 * The comparator walks both directory trees, classifies each file by
 * path pattern, applies the appropriate rule, and accumulates a
 * `violations` array. An empty array means the v3 run is regression-clean
 * against the v2 baseline.
 *
 * Note: this is a **pure deterministic comparator**. It reads filesystem
 * trees but has no side effects beyond what `readFileSync` does. Tests
 * can feed it synthetic in-memory fixtures via the `compareTrees`
 * lower-level entry point.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface DiffViolation {
  /** Relative path inside the artefact root (e.g. `STATE.md`, `phases/01-foo/01-VERIFICATION.md`). */
  readonly path: string;
  /** Category that triggered the rule (e.g. `state-md`, `plan-md`, `verification-counts`, `byte-exact`). */
  readonly category: string;
  /** One-line description of what diverged. */
  readonly detail: string;
}

export interface DiffResult {
  readonly violations: ReadonlyArray<DiffViolation>;
}

export interface DiffOptions {
  /**
   * Levenshtein-distance ceiling for STATE.md phase-summary drift.
   * Default 100 per TDD2 §14.6. Override only for unit tests.
   */
  readonly stateMdLevenshteinMax?: number;
  /**
   * Optional path-pattern overrides for tests. Each entry is
   * `[regex, category]`; the first match wins. Default falls back to
   * `defaultClassifier` below.
   */
  readonly classifiers?: ReadonlyArray<{
    readonly match: RegExp;
    readonly category: ArtefactCategory;
  }>;
}

export type ArtefactCategory =
  | 'state-md'
  | 'plan-md'
  | 'verification-counts'
  | 'semantic-fingerprint'
  | 'byte-exact';

/**
 * Top-level entry point. Walks the two artefact roots and returns the
 * violation list. The expected (v2 baseline) tree is authoritative — any
 * file present in v2 but missing in v3 is a violation; new files in v3
 * are NOT flagged (the methodology may evolve to emit additional
 * artefacts).
 */
export function diffArtefacts(
  actualRoot: string,
  expectedRoot: string,
  options: DiffOptions = {},
): DiffResult {
  const expectedFiles = walkMarkdownFiles(expectedRoot);
  const violations: DiffViolation[] = [];

  for (const relPath of expectedFiles) {
    const actualPath = join(actualRoot, relPath);
    const expectedPath = join(expectedRoot, relPath);
    if (!exists(actualPath)) {
      violations.push({
        path: relPath,
        category: 'missing',
        detail: `expected file ${relPath} is missing in actual tree`,
      });
      continue;
    }
    const actualContent = readFileSync(actualPath, 'utf8');
    const expectedContent = readFileSync(expectedPath, 'utf8');
    const category = classify(relPath, options.classifiers);
    const detail = compareFile(actualContent, expectedContent, category, options);
    if (detail !== undefined) {
      violations.push({ path: relPath, category, detail });
    }
  }
  return { violations };
}

/**
 * Lower-level entry point — compare two string contents directly
 * without filesystem access. Used by `diff-artefacts.test.ts` for
 * synthetic-fixture unit tests.
 */
export function compareFile(
  actual: string,
  expected: string,
  category: ArtefactCategory,
  options: DiffOptions = {},
): string | undefined {
  switch (category) {
    case 'state-md':
      return compareStateMd(actual, expected, options.stateMdLevenshteinMax ?? 100);
    case 'plan-md':
      return comparePlanMd(actual, expected);
    case 'verification-counts':
      return compareVerificationCounts(actual, expected);
    case 'semantic-fingerprint':
      return compareSemanticFingerprint(actual, expected);
    case 'byte-exact':
      return actual === expected
        ? undefined
        : `byte-exact mismatch (lengths: actual=${actual.length}, expected=${expected.length})`;
  }
}

// ───────────────────────────────────────────────────────────────
// classification
// ───────────────────────────────────────────────────────────────

// Per-role classifier calibration (research §5.5, REQ-22 R2).
//
// Order matters — classify() walks first-match-wins. The more-specific
// SUMMARY / PLAN / VERIFICATION patterns must come BEFORE the generic
// architect-bucket patterns so a path like phases/01/01-01-PLAN.md lands
// on plan-md rather than the architect's semantic-fingerprint bucket.
//
// Calibration:
//   - STATE.md                                 → state-md (Levenshtein ≤100)
//   - phases/NN-*/NN-MM-SUMMARY.md             → byte-exact (Dev's strict gate)
//   - phases/NN-*/...PLAN.md                   → plan-md   (Lead, task-ID-stripped)
//   - phases/NN-*/...(VERIFICATION|QA).md      → verification-counts (QA)
//   - phases/NN-*/...RESEARCH.md               → semantic-fingerprint (Scout)
//   - phases/NN-*/(CONTEXT|CONCERNS|PATTERNS).md → semantic-fingerprint (Architect)
//   - scout-briefs/* / debug-reports/*         → semantic-fingerprint
//   - README.md / CHANGELOG.md / docs/**       → byte-exact (Docs role)
//   - everything else                          → byte-exact (default)
export const DEFAULT_CLASSIFIERS: ReadonlyArray<{
  readonly match: RegExp;
  readonly category: ArtefactCategory;
}> = [
  // STATE.md anywhere (root or archived milestone)
  { match: /(^|\/)STATE\.md$/i, category: 'state-md' },
  // Dev's SUMMARY.md (NN-MM-SUMMARY.md inside a phase) — byte-exact. Must
  // come BEFORE the generic semantic-fingerprint patterns so the SUMMARY
  // bucket wins for the `NN-MM-SUMMARY.md` shape.
  {
    match: /(^|\/)phases\/\d+-[^/]+\/\d+-\d+-SUMMARY\.md$/i,
    category: 'byte-exact',
  },
  // PLAN files inside phases — both the v2 `NN-PLAN.md` and v3 `NN-MM-PLAN.md` layouts
  { match: /(^|\/)phases\/[^/]+\/.*PLAN\.md$/i, category: 'plan-md' },
  // VERIFICATION + QA files — count-sensitive
  { match: /(^|\/)phases\/[^/]+\/.*(VERIFICATION|QA)\.md$/i, category: 'verification-counts' },
  // Scout's RESEARCH inside a phase folder
  {
    match: /(^|\/)phases\/\d+-[^/]+\/(\d+-)?RESEARCH\.md$/i,
    category: 'semantic-fingerprint',
  },
  // Architect's descriptive context docs inside a phase folder
  {
    match: /(^|\/)phases\/\d+-[^/]+\/(CONTEXT|CONCERNS|PATTERNS)\.md$/i,
    category: 'semantic-fingerprint',
  },
  // Scout briefs / debug reports — semantic fingerprint
  { match: /(^|\/)(scout-briefs|debug-reports)\//i, category: 'semantic-fingerprint' },
  // Docs role's rendered artefacts — README/CHANGELOG/docs/**
  // (byte-exact is the default fall-through; the explicit entries below
  // exist so the per-role classifier test can assert the role calibration
  // surfaces in DEFAULT_CLASSIFIERS rather than silently relying on
  // fall-through.)
  { match: /^README\.md$/i, category: 'byte-exact' },
  { match: /^CHANGELOG\.md$/i, category: 'byte-exact' },
  { match: /^docs\//i, category: 'byte-exact' },
];

export function classify(
  relPath: string,
  overrides?: ReadonlyArray<{ readonly match: RegExp; readonly category: ArtefactCategory }>,
): ArtefactCategory {
  const normalized = relPath.split(sep).join('/');
  const patterns = overrides ?? DEFAULT_CLASSIFIERS;
  for (const { match, category } of patterns) {
    if (match.test(normalized)) return category;
  }
  return 'byte-exact';
}

// ───────────────────────────────────────────────────────────────
// STATE.md — strip activity-log timestamps + check phase summary
// Levenshtein drift
// ───────────────────────────────────────────────────────────────

function compareStateMd(
  actual: string,
  expected: string,
  levenshteinMax: number,
): string | undefined {
  const a = stripActivityLogTimestamps(actual);
  const e = stripActivityLogTimestamps(expected);
  // Extract the phase summary section (under `## Current Phase` or similar).
  // The summary text is what carries methodology semantics; the rest can drift.
  const aSummary = extractPhaseSummary(a);
  const eSummary = extractPhaseSummary(e);
  const distance = levenshtein(aSummary, eSummary);
  if (distance > levenshteinMax) {
    return `phase summary Levenshtein distance ${distance} > ${levenshteinMax}`;
  }
  return undefined;
}

function stripActivityLogTimestamps(s: string): string {
  // Replace `- YYYY-MM-DD:` activity-log prefixes with a fixed token.
  return s
    .replace(/^- \d{4}-\d{2}-\d{2}:/gm, '- DATE:')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, 'ISO_TIMESTAMP');
}

function extractPhaseSummary(s: string): string {
  // Pull the `## Current Phase` (or `## Phase Status`) block; fall back
  // to the whole document when the section header isn't present.
  const m = /##\s+(Current Phase|Phase Status)[\s\S]*?(?=^##\s+|\Z)/m.exec(s);
  return (m?.[0] ?? s).trim();
}

// ───────────────────────────────────────────────────────────────
// PLAN.md — allow task-ID prefix drift; compare content fingerprint
// ───────────────────────────────────────────────────────────────

function comparePlanMd(actual: string, expected: string): string | undefined {
  const aFingerprint = planContentFingerprint(actual);
  const eFingerprint = planContentFingerprint(expected);
  if (aFingerprint === eFingerprint) return undefined;
  // Produce a useful diff message — the first divergent line.
  return `task content fingerprint mismatch (actual hash=${shortHash(aFingerprint)}, expected=${shortHash(eFingerprint)})`;
}

function planContentFingerprint(s: string): string {
  // Strip task IDs (PR-NN, MN-NN, etc.) and whitespace; the remaining
  // text is the "task content" — the actual semantic instructions.
  return s
    .replace(/(^|\b)(PR-\d+|task-\d+|[A-Z]{1,4}-\d+)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────────────────────────────────────────────
// VERIFICATION / QA — counts must match exactly
// ───────────────────────────────────────────────────────────────

function compareVerificationCounts(actual: string, expected: string): string | undefined {
  const aCounts = extractCounts(actual);
  const eCounts = extractCounts(expected);
  for (const key of Object.keys(eCounts) as ReadonlyArray<keyof typeof eCounts>) {
    if (aCounts[key] !== eCounts[key]) {
      return `count mismatch on ${key}: actual=${aCounts[key]}, expected=${eCounts[key]}`;
    }
  }
  return undefined;
}

interface VerificationCounts {
  readonly passed: number | undefined;
  readonly failed: number | undefined;
  readonly total: number | undefined;
}

function extractCounts(s: string): VerificationCounts {
  // Look for `passed: N` / `failed: N` / `total: N` in YAML frontmatter
  // or body text. The regression baseline writes these consistently.
  const match = (re: RegExp): number | undefined => {
    const m = re.exec(s);
    return m === null ? undefined : Number.parseInt(m[1] ?? '', 10);
  };
  return {
    passed: match(/(?:^|\n)passed:\s*(\d+)/),
    failed: match(/(?:^|\n)failed:\s*(\d+)/),
    total: match(/(?:^|\n)total:\s*(\d+)/),
  };
}

// ───────────────────────────────────────────────────────────────
// Semantic fingerprint — URL + section headings only
// ───────────────────────────────────────────────────────────────

function compareSemanticFingerprint(actual: string, expected: string): string | undefined {
  const a = semanticFingerprint(actual);
  const e = semanticFingerprint(expected);
  if (a === e) return undefined;
  return `semantic fingerprint mismatch (actual=${shortHash(a)}, expected=${shortHash(e)})`;
}

function semanticFingerprint(s: string): string {
  const headings: string[] = [];
  for (const line of s.split('\n')) {
    if (/^#{1,6}\s/.test(line)) headings.push(line.trim());
  }
  // URLs survive — they reference external resources whose identity matters.
  const urls = Array.from(s.matchAll(/https?:\/\/[^\s)]+/g)).map((m) => m[0]);
  return [...headings, ...urls].join('\n');
}

// ───────────────────────────────────────────────────────────────
// Levenshtein (DP, O(m × n)) — bounded by stateMdLevenshteinMax
// since the comparator short-circuits at violation
// ───────────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  // Two-row DP.
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      const deletion = (prev[j] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(insertion, deletion, substitution);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}

// ───────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────

function walkMarkdownFiles(root: string): string[] {
  if (!exists(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile() && entry.endsWith('.md')) {
        // ADR-009: emit POSIX-separator relPaths; node:path.relative returns
        // platform-native separators on Windows.
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function shortHash(s: string): string {
  // Deterministic 8-char hash for short error messages. Crypto strength
  // unnecessary — the goal is just an identifier in the violation log.
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
