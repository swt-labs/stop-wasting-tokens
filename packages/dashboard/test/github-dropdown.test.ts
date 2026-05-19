/**
 * Component smoke + data-integrity coverage for `<GithubDropdown>`
 * (milestone 20, phase 01). The dashboard workspace has no Solid testing-
 * library and the vitest config runs `environment: 'node'`; load-bearing
 * logic lives in `lib/github-dropdown-helpers.ts` and is covered in
 * `github-dropdown-helpers.test.ts`. This file locks the component's
 * prop-contract shape + the `GITHUB_MENU_ITEMS` data shape + the disabled-
 * state derivation logic that drives AC-3 / AC-4 / AC-7.
 */

import { describe, expect, it } from 'vitest';

import {
  GithubDropdown,
  type GithubDropdownProps,
} from '../src/client/components/GithubDropdown.jsx';
import {
  GITHUB_MENU_ITEMS,
  type GithubMenuItem,
} from '../src/client/lib/github-dropdown-helpers.js';

describe('GithubDropdown (smoke)', () => {
  it('is a callable Solid component', () => {
    expect(typeof GithubDropdown).toBe('function');
  });

  it('satisfies the GithubDropdownProps contract', () => {
    // A typed `const` — if `GithubDropdownProps` ever drops `open` /
    // `onClose` / `onItemClick` / `hasGithubRemote` or changes their
    // signatures, this stops compiling.
    const props: GithubDropdownProps = {
      open: false,
      onClose: (): void => {},
      onItemClick: (): void => {},
      hasGithubRemote: false,
    };
    expect(props.open).toBe(false);
    expect(typeof props.onClose).toBe('function');
    expect(typeof props.onItemClick).toBe('function');
    expect(props.hasGithubRemote).toBe(false);
  });
});

describe('GITHUB_MENU_ITEMS (data integrity — locks Decision #5)', () => {
  it('contains exactly 8 items', () => {
    expect(GITHUB_MENU_ITEMS.length).toBe(8);
  });

  it('groups into exactly 3 sections', () => {
    expect(new Set(GITHUB_MENU_ITEMS.map((i) => i.section)).size).toBe(3);
  });

  it('SWT-side items (1, 7, 8) have needsRemote=false (Decision #3)', () => {
    const swtSideIds = new Set(['report-swt-bug', 'swt-docs', 'swt-changelog']);
    for (const item of GITHUB_MENU_ITEMS) {
      if (swtSideIds.has(item.id)) {
        expect(item.needsRemote, `${item.id} should be always-enabled`).toBe(false);
      }
    }
  });

  it('project-side items (2, 3, 4, 5, 6) have needsRemote=true', () => {
    const projectSideIds = new Set([
      'report-project-bug',
      'view-repo',
      'view-prs',
      'view-issues',
      'view-ci',
    ]);
    for (const item of GITHUB_MENU_ITEMS) {
      if (projectSideIds.has(item.id)) {
        expect(item.needsRemote, `${item.id} should be remote-gated`).toBe(true);
      }
    }
  });

  it('every item has a non-empty label', () => {
    for (const item of GITHUB_MENU_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('every item has a unique id', () => {
    const ids = GITHUB_MENU_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('disabled-state derivation (matches AC-3 / AC-4)', () => {
  /**
   * The component's `isDisabled` is `item.needsRemote && !props.hasGithubRemote`.
   * Encoded here as a pure predicate so the derivation contract is locked
   * independently of the JSX render.
   */
  const isDisabled = (item: GithubMenuItem, hasGithubRemote: boolean): boolean =>
    item.needsRemote && !hasGithubRemote;

  it('when hasGithubRemote=false, items 2-6 are disabled', () => {
    const disabledCount = GITHUB_MENU_ITEMS.filter((item) => isDisabled(item, false)).length;
    expect(disabledCount).toBe(5);
  });

  it('when hasGithubRemote=true, no item is disabled', () => {
    const disabledCount = GITHUB_MENU_ITEMS.filter((item) => isDisabled(item, true)).length;
    expect(disabledCount).toBe(0);
  });
});
