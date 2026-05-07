import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const RemediationResearchFrontmatterSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  round: z.string().regex(/^\d{2}$/),
  title: z.string().min(1),
  gathered: z.string().regex(ISO_DATE),
  sources_consulted: z.array(z.string()).default([]),
  files_referenced: z.array(z.string()).default([]),
  findings_summary: z.string().min(1),
  live_validation_required: z.boolean().default(false),
});

export type RemediationResearchFrontmatter = z.infer<typeof RemediationResearchFrontmatterSchema>;

export interface ParsedRemediationResearch {
  readonly frontmatter: RemediationResearchFrontmatter;
  readonly body: string;
}

export function readRemediationResearchFrontmatter(raw: string): ParsedRemediationResearch {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  return {
    frontmatter: RemediationResearchFrontmatterSchema.parse(coerce(frontmatter)),
    body,
  };
}

export function writeRemediationResearchFrontmatter(
  fm: RemediationResearchFrontmatter,
  body = '',
): string {
  const ordered: Record<string, unknown> = {
    phase: fm.phase,
    round: fm.round,
    title: fm.title,
    gathered: fm.gathered,
  };
  if (fm.sources_consulted.length > 0) ordered.sources_consulted = fm.sources_consulted;
  if (fm.files_referenced.length > 0) ordered.files_referenced = fm.files_referenced;
  ordered.findings_summary = fm.findings_summary;
  if (fm.live_validation_required) ordered.live_validation_required = true;
  return formatFrontmatter(ordered, body);
}

function coerce(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (out.live_validation_required === 'true') out.live_validation_required = true;
  if (out.live_validation_required === 'false') out.live_validation_required = false;
  return out;
}
