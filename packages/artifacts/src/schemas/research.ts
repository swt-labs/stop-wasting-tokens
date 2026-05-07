import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ResearchFrontmatterSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  plan: z
    .string()
    .regex(/^\d{2}[a-z]?$/)
    .optional(),
  gathered: z.string().regex(ISO_DATE),
  sources_consulted: z.array(z.string()).default([]),
  files_referenced: z.array(z.string()).default([]),
  findings_summary: z.string().min(1),
  live_validation_required: z.boolean().default(false),
});

export type ResearchFrontmatter = z.infer<typeof ResearchFrontmatterSchema>;

export const StandaloneResearchFrontmatterSchema = z.object({
  topic: z.string().min(1),
  gathered: z.string().regex(ISO_DATE),
  sources_consulted: z.array(z.string()).default([]),
  files_referenced: z.array(z.string()).default([]),
  findings_summary: z.string().min(1),
  live_validation_required: z.boolean().default(false),
});

export type StandaloneResearchFrontmatter = z.infer<typeof StandaloneResearchFrontmatterSchema>;

export interface ParsedResearch<T> {
  readonly frontmatter: T;
  readonly body: string;
}

export function readResearchFrontmatter(raw: string): ParsedResearch<ResearchFrontmatter> {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  return {
    frontmatter: ResearchFrontmatterSchema.parse(coerce(frontmatter)),
    body,
  };
}

export function readStandaloneResearchFrontmatter(
  raw: string,
): ParsedResearch<StandaloneResearchFrontmatter> {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  return {
    frontmatter: StandaloneResearchFrontmatterSchema.parse(coerce(frontmatter)),
    body,
  };
}

export function writeResearchFrontmatter(fm: ResearchFrontmatter, body = ''): string {
  const ordered: Record<string, unknown> = {
    phase: fm.phase,
    ...(fm.plan !== undefined ? { plan: fm.plan } : {}),
    gathered: fm.gathered,
  };
  if (fm.sources_consulted.length > 0) ordered.sources_consulted = fm.sources_consulted;
  if (fm.files_referenced.length > 0) ordered.files_referenced = fm.files_referenced;
  ordered.findings_summary = fm.findings_summary;
  if (fm.live_validation_required) ordered.live_validation_required = true;
  return formatFrontmatter(ordered, body);
}

export function writeStandaloneResearchFrontmatter(
  fm: StandaloneResearchFrontmatter,
  body = '',
): string {
  const ordered: Record<string, unknown> = {
    topic: fm.topic,
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
