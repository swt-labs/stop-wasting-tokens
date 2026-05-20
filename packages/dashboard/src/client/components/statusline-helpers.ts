/**
 * `statusline-helpers` — Statusline-extension milestone, Step 4 of 8 per
 * a_non_production_files/statusline.md.
 *
 * Pure helpers for `DashboardStatusline.tsx`. node-env vitest friendly
 * (no Solid imports, no DOM, no fetch) — mirrors the existing
 * `askuser-card-helpers.ts` + `phase-card-helpers.ts` precedent.
 *
 * The dashboard treats `ConfigSnapshot.config` as `unknown` (the SwtConfig
 * shape is not fully typed in shared schemas). This module's
 * `selectStatuslineKnobs` is the typed selector that pulls the five
 * statusline knobs out of that `unknown` config and renders missing /
 * malformed values as `null` — the statusline cell then prints `—`.
 *
 * The knob name list is sourced from `CONFIG_ENUM_OPTIONS` so a typo in
 * this file would surface as a missing key at runtime (`CONFIG_ENUM_OPTIONS`
 * is hand-mirrored from `packages/core/src/config/Config.ts` — see the
 * docblock on `config-enum-vocab.ts`).
 */

import { CONFIG_ENUM_OPTIONS } from './config-enum-vocab.js';

/**
 * The statusline knob keys, in display order. v1 included `backend` at
 * the head, but TDD3 §1.3 + REQ-01 (`commands.md`) lock v3's runtime to
 * Pi as the sole substrate — `backend` no longer parameterises anything.
 * v2 of the statusline drops the cell entirely (statusline_v2.md §D);
 * the four remaining knobs each render even when at their default value
 * because they are status indicators, not differentials.
 */
export const STATUSLINE_KNOB_KEYS = [
  'effort',
  'autonomy',
  'model_profile',
  'verification_tier',
] as const;

export type StatuslineKnobKey = (typeof STATUSLINE_KNOB_KEYS)[number];

export type StatuslineKnobs = Readonly<Record<StatuslineKnobKey, string | null>>;

/**
 * Statusline v2 Wave 5 commit 9 — format the branch cell text. Handles
 * three states:
 *
 *   - normal checkout      → `<name>` (e.g. `main`)
 *   - detached HEAD        → `detached@<short_sha>` (e.g. `detached@bc604ed`)
 *   - missing branch input → `—` (defensive; in practice the caller
 *     hides the Project group entirely when `git` is undefined, so
 *     this branch is unreachable from the live render)
 */
export function formatStatuslineBranch(
  branch: string | null,
  detached: boolean,
  shortSha: string,
): string {
  if (detached) return `detached@${shortSha}`;
  if (branch !== null && branch.length > 0) return branch;
  return '—';
}

/**
 * Statusline v2 Wave 6 commit 16 — canonical cell-id vocabulary.
 *
 * The list IS the default `config.statusline_cells` order. Each id maps
 * to one rendered cell on the bar; the `cellSection` map below assigns
 * each id to one of the five logical sections so the `│` group
 * separators can be computed dynamically (separator drawn iff the
 * current cell's section differs from the previous rendered cell's
 * section).
 *
 * Adding a new cell type to the bar means: (a) extend this array,
 * (b) extend `CELL_SECTION` below, (c) extend `ConfigSchema
 * .statusline_cells` z.enum in `@swt-labs/core`. A workspace
 * regression test guards step (c) — see `setting-descriptions.ts`
 * test.
 */
export const STATUSLINE_CELL_IDS = [
  'repo',
  'branch',
  'provider',
  'dot',
  'effort',
  'autonomy',
  'model',
  'verify',
  'cook',
  'orchestrator',
  'agents',
  'ctx',
  'rate',
  'session-cost',
  'tokens',
  'rollup-7d',
  'rollup-30d',
] as const;

export type StatuslineCellId = (typeof STATUSLINE_CELL_IDS)[number];

/**
 * Section assignment per cell id. The five sections render in the
 * canonical left-to-right order: project → identity → config →
 * runtime → money. The group separator (`│`) is drawn before the
 * first rendered cell of any section that follows a different
 * section (see `computeIsGroupStart` below).
 */
export type StatuslineSection = 'project' | 'identity' | 'config' | 'runtime' | 'money';

const CELL_SECTION: Readonly<Record<StatuslineCellId, StatuslineSection>> = {
  repo: 'project',
  branch: 'project',
  provider: 'identity',
  dot: 'identity',
  effort: 'config',
  autonomy: 'config',
  model: 'config',
  verify: 'config',
  cook: 'runtime',
  orchestrator: 'runtime',
  agents: 'runtime',
  ctx: 'runtime',
  rate: 'money',
  'session-cost': 'money',
  tokens: 'money',
  'rollup-7d': 'money',
  'rollup-30d': 'money',
};

export function statuslineCellSection(id: StatuslineCellId): StatuslineSection {
  return CELL_SECTION[id];
}

/**
 * Compute whether a cell at `index` in `cellOrder` should render the
 * leading `│` group separator. The first cell never gets one (handled
 * by CSS `:first-of-type`). Every later cell gets the marker iff its
 * section differs from the previous rendered cell's section.
 *
 * Pure + index-based so the component can call it inside its `<For>`
 * loop without rebuilding the section assignments on every render.
 */
export function computeIsGroupStart(
  cellOrder: readonly StatuslineCellId[],
  index: number,
): boolean {
  if (index <= 0 || index >= cellOrder.length) return false;
  const prev = cellOrder[index - 1];
  const current = cellOrder[index];
  if (prev === undefined || current === undefined) return false;
  return statuslineCellSection(prev) !== statuslineCellSection(current);
}

/**
 * Defensive extraction. Returns `null` for any key when:
 *   - `config` is null / undefined / non-object
 *   - the key is missing
 *   - the value is not a string
 *   - the value is the empty string
 *   - the value is not in `CONFIG_ENUM_OPTIONS[key]` (drift guard — an
 *     operator who edited config.json to a typo gets a quiet `—`, not a
 *     mystery value in the statusline)
 *
 * Strings outside the enum vocabulary are tolerated when the key has no
 * `CONFIG_ENUM_OPTIONS[key]` entry (defensive — adding a knob to this
 * helper before sync to `config-enum-vocab.ts` shouldn't crash the
 * dashboard).
 */
export function selectStatuslineKnobs(config: unknown): StatuslineKnobs {
  // Build the all-null fallback first; we'll overlay validated values.
  const result: Record<StatuslineKnobKey, string | null> = {
    effort: null,
    autonomy: null,
    model_profile: null,
    verification_tier: null,
  };

  if (config === null || typeof config !== 'object') {
    return result;
  }
  const rec = config as Record<string, unknown>;

  for (const key of STATUSLINE_KNOB_KEYS) {
    const raw = rec[key];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const allowed = CONFIG_ENUM_OPTIONS[key];
    if (allowed !== undefined && !allowed.includes(raw)) continue;
    result[key] = raw;
  }
  return result;
}
