/**
 * Themes dropdown — pure helpers (no DOM imports beyond `document` in
 * `applyTheme`, which is guarded so the node-env vitest run stays happy).
 *
 * The canonical 8 theme ids live in `@swt-labs/core` (`THEMES` constant +
 * `Theme` union); this module wraps each id with display metadata
 * (label + description) for the dropdown UI plus the `applyTheme` DOM
 * helper that flips the `data-theme` attribute on `<html>`.
 *
 * Why this lives in a `lib/` file (not the component): the component test
 * env in `packages/dashboard/test/` runs `environment: 'node'` with an
 * esbuild transform that can't emit Solid JSX runtime calls. Pure helpers
 * here are unit-testable directly; the component itself is exercised via
 * a smoke test that asserts it's a callable Solid component (mirrors the
 * GithubDropdown / OptionsMenu split).
 */

import type { Theme } from '@swt-labs/core';

/**
 * Local mirror of `THEMES` from `@swt-labs/core` (kept as a runtime const
 * so `isTheme` can use it). Why duplicate instead of importing the value:
 * `@swt-labs/core` re-exports `./scaffold/init-project.js` at the barrel,
 * which uses `node:fs` and `node:path`. Vite's browser bundler can't
 * externalise those for the SPA build, and at present vite does not
 * honour `sideEffects: false` aggressively enough across the pnpm
 * workspace boundary to tree-shake the scaffold module out. The local
 * mirror sidesteps the bundling issue; `LOCAL_THEMES` is kept identical
 * to the canonical core `THEMES` by a parity test in
 * `themes-dropdown-helpers.test.ts` (test runs in node-env where
 * importing core is safe).
 *
 * If core grows a browser-safe subpath export (e.g. `@swt-labs/core/config`),
 * this local can collapse back to a single import.
 */
export const LOCAL_THEMES: readonly Theme[] = [
  'default',
  'dark',
  'light',
  'solarized',
  'dracula',
  'nord',
  'monokai',
  'gruvbox',
] as const;

export interface ThemeOption {
  id: Theme;
  label: string;
  description: string;
}

/**
 * Ordered dropdown menu data. Order is intentional: Default first (the
 * SWT canon), then Dark and Light (the two most expected toggles for a
 * mainstream audience), then the five named developer themes alphabetised.
 */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: 'default', label: 'Default', description: 'SWT terminal — green on black' },
  { id: 'dark', label: 'Dark', description: 'Clean modern dark' },
  { id: 'light', label: 'Light', description: 'White background, dark text' },
  { id: 'dracula', label: 'Dracula', description: 'dracula.io palette' },
  { id: 'gruvbox', label: 'Gruvbox', description: 'Retro groove' },
  { id: 'monokai', label: 'Monokai', description: 'Sublime Text classic' },
  { id: 'nord', label: 'Nord', description: 'Arctic Ice Studio' },
  { id: 'solarized', label: 'Solarized', description: "Schoonover's classic" },
] as const;

/**
 * Apply a theme to the document by setting the `data-theme` attribute on
 * `<html>`. The CSS in `styles.css` defines `:root[data-theme="X"]`
 * blocks that override the 9 base CSS variables; component styles reading
 * `var(--name)` re-skin automatically.
 *
 * The `'default'` theme intentionally SETS the attribute (to `"default"`)
 * rather than removing it — symmetric with the named themes, and makes a
 * subsequent `getAttribute('data-theme')` assertion crisp. Per the CSS
 * comment in `styles.css`, the `[data-theme="default"]` selector is
 * intentionally NOT defined and falls back to the bare `:root` block.
 *
 * Guarded for the node-env vitest run (no `document` global).
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Type guard for a value coming from the wire (config snapshot, URL param,
 * a partially-validated cross-version `.swt-planning/config.json`, etc.).
 * Returns true when the value matches one of the 8 known theme ids.
 *
 * Callers should narrow via this guard BEFORE invoking `applyTheme` —
 * an unknown string in `data-theme` would silently fall through to the
 * default palette, which is correct fallback behaviour but obscures the
 * cause. Explicit narrowing surfaces the mismatch.
 */
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (LOCAL_THEMES as readonly string[]).includes(value);
}
