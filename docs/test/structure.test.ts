import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_ROOT = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(DOCS_ROOT, 'docs.json'), 'utf8'));

const EXPECTED_GROUPS = [
  'Getting Started',
  'Concepts',
  'Reference',
  'Recipes',
  'Migration',
  'Blog',
  'v1.5 Roadmap',
];

describe('docs.json structure', () => {
  it('has the 7 expected top-level navigation groups', () => {
    const groups = config.navigation.map((n: { group: string }) => n.group);
    expect(groups).toEqual(EXPECTED_GROUPS);
  });

  it('every page reference resolves to a real .mdx file', () => {
    const missing: string[] = [];
    for (const group of config.navigation) {
      for (const page of group.pages ?? []) {
        if (typeof page !== 'string') continue;
        const filePath = join(DOCS_ROOT, `${page}.mdx`);
        if (!existsSync(filePath)) missing.push(page);
      }
    }
    expect(missing, `missing pages: ${missing.join(', ')}`).toEqual([]);
  });

  it('declares the canonical Mintlify schema', () => {
    expect(config.$schema).toBe('https://mintlify.com/docs.json');
    expect(config.name).toBe('stop-wasting-tokens');
    expect(config.theme).toBe('mint');
  });
});
