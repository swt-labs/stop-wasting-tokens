import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_ROOT = join(__dirname, '..');
const REPO_ROOT = join(DOCS_ROOT, '..');

describe('beta-feedback infrastructure', () => {
  it('beta-feedback.mdx exists and references friction + telemetry', () => {
    const path = join(DOCS_ROOT, 'recipes', 'beta-feedback.mdx');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('friction');
    expect(content).toContain('telemetry');
  });

  it('CODE_OF_CONDUCT.md exists at repo root', () => {
    expect(existsSync(join(REPO_ROOT, 'CODE_OF_CONDUCT.md'))).toBe(true);
  });

  it('friction issue template exists', () => {
    const path = join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', 'friction.md');
    expect(existsSync(path)).toBe(true);
  });

  it('all 3 GitHub Discussions templates exist', () => {
    const dir = join(REPO_ROOT, '.github', 'DISCUSSION_TEMPLATE');
    for (const name of ['ideas.yml', 'q-and-a.yml', 'show-and-tell.yml']) {
      expect(existsSync(join(dir, name)), name).toBe(true);
    }
  });

  it('all 4 announcement templates exist', () => {
    const dir = join(REPO_ROOT, '.vbw-planning', 'announcements');
    for (const name of [
      'discord-vbw-community.md',
      'hacker-news-show.md',
      'reddit-r-codex.md',
      'twitter-x.md',
    ]) {
      expect(existsSync(join(dir, name)), name).toBe(true);
    }
  });

  it('docs.json includes beta-feedback in Recipes navigation', () => {
    const config = JSON.parse(readFileSync(join(DOCS_ROOT, 'docs.json'), 'utf8'));
    const recipes = config.navigation.find((g: { group: string }) => g.group === 'Recipes');
    expect(recipes?.pages).toContain('recipes/beta-feedback');
  });
});
