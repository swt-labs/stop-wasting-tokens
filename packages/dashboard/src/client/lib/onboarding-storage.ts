/**
 * First-run onboarding overlay state. Defaults to "show" for new visitors;
 * dismiss persists in localStorage under `swt:dashboard:onboarded-v1`.
 *
 * The version suffix (`-v1`) lets future onboarding updates (new steps, new
 * UI) re-trigger the overlay for users who have already dismissed v1 by
 * bumping the key to `-v2`. v1 stays untouched so an explicit re-dismiss
 * isn't needed.
 *
 * Mirrors the defensive `getStorage()` pattern from `layout-storage.ts`:
 * tolerates missing `localStorage` (server-side render, private mode,
 * disabled storage) by treating it as "show overlay" — no persistence,
 * the user just gets the explainer once per session.
 */

const STORAGE_KEY = 'swt:dashboard:onboarded-v1';

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
 * Returns `true` when the onboarding overlay should be displayed.
 * Default is `true` for first-time visitors and when storage is unavailable.
 */
export function shouldShowOnboarding(): boolean {
  const storage = getStorage();
  if (!storage) return true;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw !== 'dismissed';
  } catch {
    return true;
  }
}

/**
 * Persists the dismiss decision. Subsequent calls to `shouldShowOnboarding()`
 * return `false` until the storage key is cleared or its version bumped.
 */
export function markOnboardingDismissed(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, 'dismissed');
  } catch {
    // Quota errors / disabled storage — fail silently. The overlay will
    // re-appear next session, which is a recoverable annoyance, not a
    // correctness issue.
  }
}
