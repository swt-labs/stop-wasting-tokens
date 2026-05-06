import { describe, expect, it } from 'vitest';

import { formatFrontmatter, parseFrontmatter } from '../src/frontmatter.js';

describe('frontmatter', () => {
  it('parses a simple frontmatter block', () => {
    const input = '---\nname: "swt"\nversion: 1\n---\n\nbody here\n';
    const parsed = parseFrontmatter<{ name: string; version: number }>(input);
    expect(parsed.frontmatter.name).toBe('swt');
    expect(parsed.frontmatter.version).toBe(1);
    expect(parsed.body.trim()).toBe('body here');
  });

  it('returns an empty frontmatter when no fence is present', () => {
    const parsed = parseFrontmatter('# Just a heading\n');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toContain('Just a heading');
  });

  it('parses inline arrays and booleans', () => {
    const input = '---\ntags: ["a", "b", "c"]\nactive: true\nnope: false\nnum: 42\n---\n\nx\n';
    const parsed = parseFrontmatter<{ tags: string[]; active: boolean; num: number }>(input);
    expect(parsed.frontmatter.tags).toEqual(['a', 'b', 'c']);
    expect(parsed.frontmatter.active).toBe(true);
    expect(parsed.frontmatter.num).toBe(42);
  });

  it('round-trips through format + parse', () => {
    const fm = { name: 'swt', version: 1, tags: ['cli', 'codex'] };
    const formatted = formatFrontmatter(fm, 'body content');
    const parsed = parseFrontmatter(formatted);
    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body.trim()).toBe('body content');
  });

  it('handles missing closing fence by treating input as body-only', () => {
    const broken = '---\nname: "swt"\n\n# heading\n';
    const parsed = parseFrontmatter(broken);
    expect(parsed.frontmatter).toEqual({});
  });
});
