// v2.3 Phase 02 bumped the storage key from `-v1` to `-v2` because the
// `main` array gained a 5th column for the new tools panels. The User
// Notes card bumped it to `-v3` because the `tools` array gained a 6th
// slot. It bumped to `-v4` when the `tools` array DROPPED back to 5
// slots — ProviderAuthPanel moved to the TopBar "Provider ▾" dropdown.
// It bumped to `-v5` when ProjectStatePanel was folded INTO the
// tools-column inner `<Resizable>` as the first resizable panel,
// taking the `tools` array up to 6 slots.
//
// It bumped to `-v6` because three cards were removed by user request:
// ProjectStatePanel (was tools[0]), UpdatePanel (was tools[4]), and
// ProviderCostPanel (middle-column inline stack — wasn't in the tools
// array). The `tools` array shrunk from 6 → 4 entries:
// [Config, Doctor, DetectPhase, UserNotes].
//
// This bumps to `-v7` (milestone 09 / Phase 03 — 2026-05-15) because
// four right-column cards were removed: CostPanel, BudgetPanel,
// CacheHitPanel, TpacPanel. Their data is now surfaced by the Phase 02
// viewport-fixed DashboardStatusline (cost/tokens) and consumed
// externally via the preserved /api/budget, /api/cache-hits, /api/tpac,
// /api/provider-cost routes. The 4 cards lived as component siblings
// inside the same right[1] Resizable.Panel (NOT as separate resizable
// panels), so no array shape changes — `right` stays 2 entries, and
// `right[1]` now renders only WorktreesPanel. This is a pure key
// rotation following the established pattern: old keys become orphaned
// but don't break — `getStorage` only reads the current key and falls
// through to `DEFAULT_LAYOUT` when it's absent.
//
// It bumps to `-v8` because the PHASES and ARTIFACTS panes were merged
// into a single PhaseStepper card (see a_non_production_files/
// artifacts.md). The two previously-adjacent `main` entries collapse
// into one. The `main` array shrinks from 5 → 4 entries:
// [phasesCard, center, right, tools]. Users on v7 with a 5-element
// `main` array fall through to DEFAULT_LAYOUT here (the v7 key is
// never read because the storage key changed); the validator in
// `loadLayout` rejects mismatched array lengths, so any direct
// v7→v8 read attempts also fail-safe.
//
// It bumps to `-v9` (Options Menu Consolidation / plan 01-03 —
// 2026-05-17) because ConfigPanel was deleted and its `Resizable.Panel`
// slot removed from the tools column. The `tools` array shrinks from
// 4 → 3 entries: [Doctor, DetectPhase, UserNotes]. Per the plan, the
// forward-migration shim in `loadLayout` SLICES any persisted-longer
// `tools` array to the new length and logs ONE `console.debug` line
// (the migration handles users who already had a v9 read attempt with
// the old 4-element shape, or anyone who manually edited the v9 key
// with a stale length). The shim does NOT write back; the next persist
// cycle (the first user resize) overwrites with the new shape.
//
// It bumps to `-v10` (2026-05-17) because DoctorPanel and DetectPhasePanel
// were removed at user request — they were diagnostic-only and not
// driving the daily flow. UserNotesPanel is the only remaining tools-
// column card, so the inner vertical Resizable wrapper is gone too
// (one panel doesn't need resizing). The `tools` array shrinks from
// 3 entries to an empty array (`[]`) — kept as a field on the
// DashboardLayout shape so a future return of multi-panel tooling
// doesn't need another schema migration. The forward-migration shim
// from v9 still trims persisted-longer arrays (4 → 0, 3 → 0, etc.)
// down to the new empty default with a single console.debug.
const STORAGE_KEY = 'swt:dashboard:layout-v10';

/**
 * Plan 01-03 — one-shot console.debug latch for the tools-array
 * forward-migration shim. The shim should log the slicing exactly once
 * per page load (a user with a longer persisted array would otherwise
 * see the line every time `loadLayout` is called — and loadLayout runs
 * once at mount, but defensive against future refactors that might
 * call it again).
 */
let toolsMigrationLogged = false;

export type DashboardLayout = {
  /** 4 entries: [phasesCard, center, right, tools]. Was 5 in v7 — the
   *  ArtifactTree column was merged into the PhaseStepper card so the
   *  artifactTree slot disappears entirely. */
  main: number[];
  /** 2 entries: [preview, log]. */
  center: number[];
  /** 2 entries: [agentTimeline, worktreesPanel].
   *  Was [agentTimeline, costPanel] in v6 — the 4 right-column cards
   *  (CostPanel/BudgetPanel/CacheHitPanel/TpacPanel) were removed in
   *  Phase 03; right[1] now holds WorktreesPanel only. */
  right: number[];
  /** 0 entries — v10 collapsed the inner vertical Resizable when
   *  DoctorPanel + DetectPhasePanel were removed at user request.
   *  UserNotesPanel renders directly inside the outer tools-column
   *  panel without an inner resize stack. The field is preserved on
   *  the shape so a future multi-panel tools column does not need
   *  another schema migration — extending the empty default is enough.
   *  Was 3 in v9 (Doctor / DetectPhase / UserNotes). */
  tools: number[];
};

export const DEFAULT_LAYOUT: DashboardLayout = {
  // v8: phasesCard absorbs the prior phaseStepper + artifactTree widths
  // (0.12 + 0.15 = 0.27). center/right/tools proportions stay the same.
  main: [0.27, 0.45, 0.13, 0.15],
  center: [0.65, 0.35],
  right: [0.65, 0.35],
  // v10: tools column has only UserNotesPanel; no inner resizing.
  tools: [],
};

const isFractionArray = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1);

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getStorage(): MinimalStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: MinimalStorage }).localStorage;
  return ls ?? null;
}

/**
 * Plan 01-03 — forward-migration shim for the `tools` array. The current
 * default length is 3 (`DEFAULT_LAYOUT.tools.length`); a persisted-longer
 * `tools` array (length 4 from a v9 read attempt of stale data, or
 * length-N from a hypothetical future regression) is SLICED down to the
 * new default length and a single `console.debug` line records the
 * migration. Pure: it does NOT mutate the persisted storage value — the
 * next persist cycle (first user resize) overwrites with the new shape.
 *
 * Exported only for testing. Production code reaches it via `loadLayout`.
 */
export function migrateToolsArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const target = DEFAULT_LAYOUT.tools.length;
  if (raw.length > target) {
    const sliced = raw.slice(0, target);
    if (isFractionArray(sliced, target)) {
      if (!toolsMigrationLogged) {
        toolsMigrationLogged = true;

        console.debug(
          `[layout] migrating persisted tools array from ${raw.length} to ${target} entries`,
        );
      }
      return sliced;
    }
  }
  return null;
}

export function loadLayout(): DashboardLayout {
  const storage = getStorage();
  if (!storage) return DEFAULT_LAYOUT;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const target = DEFAULT_LAYOUT.tools.length;
    const tools = isFractionArray(parsed.tools, target)
      ? parsed.tools
      : (migrateToolsArray(parsed.tools) ?? DEFAULT_LAYOUT.tools);
    return {
      main: isFractionArray(parsed.main, 4) ? parsed.main : DEFAULT_LAYOUT.main,
      center: isFractionArray(parsed.center, 2) ? parsed.center : DEFAULT_LAYOUT.center,
      right: isFractionArray(parsed.right, 2) ? parsed.right : DEFAULT_LAYOUT.right,
      tools,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: DashboardLayout): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage may be unavailable (private mode, quota) — fail silently.
  }
}
