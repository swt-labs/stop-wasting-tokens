// v2.3 Phase 02 bumped the storage key from `-v1` to `-v2` because the
// `main` array gained a 5th column for the new tools panels. The User
// Notes card bumped it to `-v3` because the `tools` array gained a 6th
// slot. This bumps it to `-v4` because the `tools` array DROPPED back to
// 5 slots — ProviderAuthPanel moved to the TopBar "Provider ▾" dropdown,
// so an old `-v3` value has a 6-element `tools` array that would now fail
// `isFractionArray(..., 5)` and silently fall through to `DEFAULT_LAYOUT`;
// bumping the key makes the reset explicit. Old keys become orphaned but
// don't break — `getStorage` only reads the current key and falls through
// to `DEFAULT_LAYOUT` when it's absent.
const STORAGE_KEY = 'swt:dashboard:layout-v4';

export type DashboardLayout = {
  /** 5 entries: [phaseStepper, artifactTree, center, right, tools]. */
  main: number[];
  /** 2 entries: [preview, log]. */
  center: number[];
  /** 2 entries: [agentTimeline, costPanel]. */
  right: number[];
  /** 5 entries: vertical split inside the tools column —
   *  [Config, Doctor, DetectPhase, Update, UserNotes].
   *  ProviderAuth was the 5th slot until it moved to the TopBar
   *  "Provider ▾" dropdown; UserNotes is now the 5th. */
  tools: number[];
};

export const DEFAULT_LAYOUT: DashboardLayout = {
  main: [0.12, 0.15, 0.45, 0.13, 0.15],
  center: [0.65, 0.35],
  right: [0.65, 0.35],
  // 5-way even split (0.2 each — sums to exactly 1).
  tools: [0.2, 0.2, 0.2, 0.2, 0.2],
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
      tools: isFractionArray(parsed.tools, 5) ? parsed.tools : DEFAULT_LAYOUT.tools,
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
