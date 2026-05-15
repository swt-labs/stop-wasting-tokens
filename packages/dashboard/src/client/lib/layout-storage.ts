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
const STORAGE_KEY = 'swt:dashboard:layout-v7';

export type DashboardLayout = {
  /** 5 entries: [phaseStepper, artifactTree, center, right, tools]. */
  main: number[];
  /** 2 entries: [preview, log]. */
  center: number[];
  /** 2 entries: [agentTimeline, worktreesPanel].
   *  Was [agentTimeline, costPanel] in v6 — the 4 right-column cards
   *  (CostPanel/BudgetPanel/CacheHitPanel/TpacPanel) were removed in
   *  Phase 03; right[1] now holds WorktreesPanel only. */
  right: number[];
  /** 4 entries: vertical split inside the tools column —
   *  [Config, Doctor, DetectPhase, UserNotes]. ProjectState and Update
   *  were removed by user request in the post-07-milestone cleanup. */
  tools: number[];
};

export const DEFAULT_LAYOUT: DashboardLayout = {
  main: [0.12, 0.15, 0.45, 0.13, 0.15],
  center: [0.65, 0.35],
  right: [0.65, 0.35],
  // 4-way split: every entry gets 0.25 evenly. Sum is exactly 1.0 and
  // every entry is well above the 0.1 minSize floor.
  tools: [0.25, 0.25, 0.25, 0.25],
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

export function loadLayout(): DashboardLayout {
  const storage = getStorage();
  if (!storage) return DEFAULT_LAYOUT;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    return {
      main: isFractionArray(parsed.main, 5) ? parsed.main : DEFAULT_LAYOUT.main,
      center: isFractionArray(parsed.center, 2) ? parsed.center : DEFAULT_LAYOUT.center,
      right: isFractionArray(parsed.right, 2) ? parsed.right : DEFAULT_LAYOUT.right,
      tools: isFractionArray(parsed.tools, 4) ? parsed.tools : DEFAULT_LAYOUT.tools,
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
