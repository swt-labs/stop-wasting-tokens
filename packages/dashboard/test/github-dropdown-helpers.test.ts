/**
 * Pure-helper coverage for `lib/github-dropdown-helpers.ts` (milestone 20,
 * phase 01). The component itself ships a smoke-test in
 * `github-dropdown.test.ts` — load-bearing logic lives here.
 *
 * The dashboard's vitest config runs `environment: 'node'` with no Solid
 * testing-library; all assertions are pure-data over the helper exports.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GITHUB_MENU_ITEMS,
  SECTION_LABELS,
  getDisabledTooltip,
  groupItemsBySection,
  hasGithubRemote,
  type GithubMenuItem,
} from '../src/client/lib/github-dropdown-helpers.js';

describe('hasGithubRemote', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false by default (no window query string)', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    expect(hasGithubRemote()).toBe(false);
  });

  it('returns true when ?fake_remote=true is set', () => {
    vi.stubGlobal('window', { location: { search: '?fake_remote=true' } });
    expect(hasGithubRemote()).toBe(true);
  });

  it('returns false when ?fake_remote=false is set', () => {
    vi.stubGlobal('window', { location: { search: '?fake_remote=false' } });
    expect(hasGithubRemote()).toBe(false);
  });

  it('returns false for any other param value', () => {
    vi.stubGlobal('window', { location: { search: '?fake_remote=yes' } });
    expect(hasGithubRemote()).toBe(false);
    vi.stubGlobal('window', { location: { search: '?other=true' } });
    expect(hasGithubRemote()).toBe(false);
  });

  it('returns false when window is undefined (SSR safety)', () => {
    vi.stubGlobal('window', undefined);
    expect(hasGithubRemote()).toBe(false);
  });
});

describe('getDisabledTooltip', () => {
  it('returns the verbatim brief Decision #2 string', () => {
    expect(getDisabledTooltip()).toBe(
      'No GitHub remote configured for this project — add one with `git remote add origin git@github.com:owner/repo.git`',
    );
  });
});

describe('groupItemsBySection', () => {
  it('groups GITHUB_MENU_ITEMS into 3 ordered sections', () => {
    const grouped = groupItemsBySection(GITHUB_MENU_ITEMS);
    expect(grouped.length).toBe(3);
    expect(grouped.map(([section]) => section)).toEqual([
      'bug-reports',
      'project',
      'swt-resources',
    ]);
  });

  it('preserves item order within each section', () => {
    const grouped = groupItemsBySection(GITHUB_MENU_ITEMS);
    const byId = (items: readonly GithubMenuItem[]): string[] => items.map((i) => i.id);
    const bugReports = grouped.find(([s]) => s === 'bug-reports');
    const project = grouped.find(([s]) => s === 'project');
    const swtResources = grouped.find(([s]) => s === 'swt-resources');
    expect(bugReports && byId(bugReports[1])).toEqual(['report-swt-bug', 'report-project-bug']);
    expect(project && byId(project[1])).toEqual([
      'view-repo',
      'view-prs',
      'view-issues',
      'view-ci',
    ]);
    expect(swtResources && byId(swtResources[1])).toEqual(['swt-docs', 'swt-changelog']);
  });

  it('handles empty input', () => {
    expect(groupItemsBySection([])).toEqual([]);
  });
});

describe('SECTION_LABELS', () => {
  it('uses uppercase labels per brief Decision #6', () => {
    expect(SECTION_LABELS['bug-reports']).toBe('BUG REPORTS');
    expect(SECTION_LABELS['project']).toBe('PROJECT ON GITHUB');
    expect(SECTION_LABELS['swt-resources']).toBe('SWT RESOURCES');
  });
});
