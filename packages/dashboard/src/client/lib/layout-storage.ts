// v2.3 Phase 02 bumped the storage key from `-v1` to `-v2` because the
// `main` array gained a 5th column for the new tools panels. The User
// Notes card bumped it to `-v3` because the `tools` array gained a 6th
// slot. It bumped to `-v4` when the `tools` array DROPPED back to 5
// slots — ProviderAuthPanel moved to the TopBar "Provider ▾" dropdown.
// It bumped to `-v5` when ProjectStatePanel was folded INTO the
// tools-column inner `<Resizable>` as the first resizable panel,
// taking the `tools` array up to 6 slots.
//
// This bumps to `-v6` because three cards were removed by user request:
// ProjectStatePanel (was tools[0]), UpdatePanel (was tools[4]), and
// ProviderCostPanel (middle-column inline stack — wasn't in the tools
// array). The `tools` array shrinks from 6 → 4 entries:
// [Config, Doctor, DetectPhase, UserNotes]. An old `-v5` value has a
// 6-element `tools` array that would now fail
// `isFractionArray(..., 4)` and silently fall through to
// `DEFAULT_LAYOUT`; bumping the key makes the reset explicit. Old keys
// become orphaned but don't break — `getStorage` only reads the current
// key and falls through to `DEFAULT_LAYOUT` when it's absent.
const STORAGE_KEY = 'swt:dashboard:layout-v6';

export type DashboardLayout = {
  /** 5 entries: [phaseStepper, artifactTree, center, right, tools]. */
  main: number[];
  /** 2 entries: [preview, log]. */
  center: number[];
  /** 2 entries: [agentTimeline, costPanel]. */
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
