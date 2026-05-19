/**
 * Pure helpers for the `<GithubDropdown>` component (milestone 20, phase 01).
 *
 * `GithubDropdown` itself is a thin Solid view over a fixed menu shape: 8
 * items in 3 sections, with a binary enabled/disabled state derived from
 * whether the current project has a GitHub remote. All load-bearing logic
 * lives HERE (not inside the component) so the dashboard's node-env vitest
 * can unit-test it directly — the workspace has no `@solidjs/testing-library`
 * and the esbuild transform cannot emit Solid-compatible JSX runtime calls.
 *
 * Three exports drive the behaviour:
 *   - `GITHUB_MENU_ITEMS`     — locked-order constant (8 × 3 sections).
 *   - `hasGithubRemote()`     — v1 stub; default `false`, honours
 *                               `?fake_remote=true` URL param for dev.
 *   - `getDisabledTooltip()`  — verbatim tooltip text for gated items.
 *   - `groupItemsBySection()` — order-preserving section grouper.
 *   - `SECTION_LABELS`        — uppercase per-section heading strings.
 */

export interface GithubMenuItem {
  id: string;
  label: string;
  section: 'bug-reports' | 'project' | 'swt-resources';
  needsRemote: boolean;
}

/**
 * The locked 8-item × 3-section menu shape. Order matches the brief's
 * mockup (lines 117-136); tests assert this exact order. SWT-side items
 * (ids `report-swt-bug`, `swt-docs`, `swt-changelog`) have `needsRemote: false`;
 * the remaining 5 are gated on the current project having a GitHub remote.
 */
export const GITHUB_MENU_ITEMS: readonly GithubMenuItem[] = [
  {
    id: 'report-swt-bug',
    label: 'Report a SWT bug to the team',
    section: 'bug-reports',
    needsRemote: false,
  },
  {
    id: 'report-project-bug',
    label: 'Report a bug to current project',
    section: 'bug-reports',
    needsRemote: true,
  },
  { id: 'view-repo', label: 'View project on GitHub', section: 'project', needsRemote: true },
  { id: 'view-prs', label: 'View open PRs', section: 'project', needsRemote: true },
  { id: 'view-issues', label: 'View open issues', section: 'project', needsRemote: true },
  { id: 'view-ci', label: 'View CI status', section: 'project', needsRemote: true },
  { id: 'swt-docs', label: 'SWT docs', section: 'swt-resources', needsRemote: false },
  { id: 'swt-changelog', label: 'SWT changelog', section: 'swt-resources', needsRemote: false },
];

/**
 * Uppercase section-heading labels per Decision #6. The keys are the
 * `GithubMenuItem['section']` discriminator values; the values are the
 * exact strings rendered in `.github-dropdown-section-label` rows.
 */
export const SECTION_LABELS: Record<GithubMenuItem['section'], string> = {
  'bug-reports': 'BUG REPORTS',
  project: 'PROJECT ON GITHUB',
  'swt-resources': 'SWT RESOURCES',
};

/**
 * v1 stub: returns `true` iff `?fake_remote=true` is in the URL query string;
 * `false` otherwise (including SSR / non-browser contexts).
 *
 * Per brief Decision #7, real `git remote -v` discovery is deferred to the
 * first Tier-2 wiring milestone (View project on GitHub — that one needs the
 * actual URL). The `?fake_remote=true` dev toggle exists so the enabled state
 * is reachable without real discovery during scaffolding QA.
 */
export function hasGithubRemote(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fake_remote') === 'true';
}

/**
 * The exact tooltip string rendered on disabled menu items, per brief
 * Decision #2. Hoisted to a single helper so the test suite asserts against
 * ONE source of truth — changing the copy here is the only place it changes.
 */
export function getDisabledTooltip(): string {
  return 'No GitHub remote configured for this project — add one with `git remote add origin git@github.com:owner/repo.git`';
}

/**
 * Order-preserving grouping of menu items by `section`. Iterates `items` in
 * the order given, keying a `Map` on first-seen section — so the resulting
 * `[section, items[]]` tuple array preserves both inter-section order (first
 * appearance) and intra-section order (insertion). Empty input → `[]`.
 *
 * Lifted out of the component (where the brief sketch inlined it) so the
 * grouping invariants — "3 sections", "items in mockup order" — are unit-
 * testable without rendering JSX.
 */
export function groupItemsBySection(
  items: readonly GithubMenuItem[],
): Array<[GithubMenuItem['section'], GithubMenuItem[]]> {
  const map = new Map<GithubMenuItem['section'], GithubMenuItem[]>();
  for (const item of items) {
    const existing = map.get(item.section);
    if (existing) {
      existing.push(item);
    } else {
      map.set(item.section, [item]);
    }
  }
  return [...map.entries()];
}
