// v2.3 Phase 02 bumped the storage key from `-v1` to `-v2` because the
// `main` array gained a 5th column for the new tools panels. Old `-v1`
// localStorage keys become orphaned but don't break — `getStorage`
// only reads the current key and falls through to `DEFAULT_LAYOUT` when
// it's absent. Documented in the v2.3.0 CHANGELOG.
const STORAGE_KEY = 'swt:dashboard:layout-v2';

export type DashboardLayout = {
  /** 5 entries: [phaseStepper, artifactTree, center, right, tools]. */
  main: number[];
  /** 2 entries: [preview, log]. */
  center: number[];
  /** 2 entries: [agentTimeline, costPanel]. */
  right: number[];
  /** 5 entries: vertical split inside the tools column —
   *  [Config, Doctor, DetectPhase, Update, ProviderAuth]. Phase 3
   *  appended the ProviderAuth panel as the 5th slot. */
  tools: number[];
};

export const DEFAULT_LAYOUT: DashboardLayout = {
  main: [0.12, 0.15, 0.45, 0.13, 0.15],
  center: [0.65, 0.35],
  right: [0.65, 0.35],
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
