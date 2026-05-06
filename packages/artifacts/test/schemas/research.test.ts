import { describe, expect, it } from 'vitest';

import {
  ResearchFrontmatterSchema,
  StandaloneResearchFrontmatterSchema,
  readResearchFrontmatter,
  readStandaloneResearchFrontmatter,
  writeResearchFrontmatter,
  writeStandaloneResearchFrontmatter,
} from '../../src/schemas/research.js';

describe('ResearchFrontmatterSchema', () => {
  it('parses minimal phase research', () => {
    const fm = ResearchFrontmatterSchema.parse({
      phase: '03',
      gathered: '2026-05-06',
      findings_summary: 'Three patterns identified.',
    });
    expect(fm.phase).toBe('03');
    expect(fm.live_validation_required).toBe(false);
  });

  it('parses phase + plan research with all fields', () => {
    const fm = ResearchFrontmatterSchema.parse({
      phase: '03',
      plan: '02',
      gathered: '2026-05-06',
      sources_consulted: ['MDN', 'Zod docs'],
      files_referenced: ['packages/core/src/index.ts'],
      findings_summary: 'Plan-scoped research',
      live_validation_required: true,
    });
    expect(fm.plan).toBe('02');
    expect(fm.live_validation_required).toBe(true);
  });

  it('rejects malformed gathered dates', () => {
    expect(() =>
      ResearchFrontmatterSchema.parse({
        phase: '03',
        gathered: 'yesterday',
        findings_summary: 'x',
      }),
    ).toThrow();
  });

  it('round-trips a phase research doc through write + read', () => {
    const fm = ResearchFrontmatterSchema.parse({
      phase: '03',
      plan: '02',
      gathered: '2026-05-06',
      sources_consulted: ['Zod docs'],
      files_referenced: ['packages/artifacts/src/schemas/plan.ts'],
      findings_summary: 'Plan schema research',
      live_validation_required: false,
    });
    const rendered = writeResearchFrontmatter(fm, '# Research\n\nbody\n');
    const reparsed = readResearchFrontmatter(rendered);
    expect(reparsed.frontmatter).toEqual(fm);
    expect(reparsed.body.trim()).toContain('body');
  });
});

describe('StandaloneResearchFrontmatterSchema', () => {
  it('round-trips a standalone topic research doc', () => {
    const fm = StandaloneResearchFrontmatterSchema.parse({
      topic: 'Codex CLI hooks',
      gathered: '2026-05-06',
      findings_summary: 'Codex emits 11 hook events.',
    });
    const rendered = writeStandaloneResearchFrontmatter(fm, 'body content\n');
    const reparsed = readStandaloneResearchFrontmatter(rendered);
    expect(reparsed.frontmatter.topic).toBe('Codex CLI hooks');
    expect(reparsed.frontmatter.live_validation_required).toBe(false);
  });
});
