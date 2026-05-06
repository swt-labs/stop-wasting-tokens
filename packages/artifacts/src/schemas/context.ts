import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

export const PhaseContextFrontmatterSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  goal: z.string().min(1),
  requirements: z.array(z.string()).default([]),
  success_criteria: z.array(z.string()).default([]),
  pre_seeded: z.boolean().default(false),
});

export type PhaseContextFrontmatter = z.infer<typeof PhaseContextFrontmatterSchema>;

export interface PhaseContextDoc {
  readonly frontmatter: PhaseContextFrontmatter;
  readonly notes: string;
  readonly decisions: string;
  readonly deferred_ideas: string;
}

export function parsePhaseContext(raw: string): PhaseContextDoc {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  const fm = PhaseContextFrontmatterSchema.parse(coerceBoolean(frontmatter, 'pre_seeded'));
  return {
    frontmatter: fm,
    notes: extractSection(body, 'Notes'),
    decisions: extractSection(body, 'Decisions'),
    deferred_ideas: extractSection(body, 'Deferred Ideas'),
  };
}

export function renderPhaseContext(doc: PhaseContextDoc): string {
  const ordered: Record<string, unknown> = {
    phase: doc.frontmatter.phase,
    slug: doc.frontmatter.slug,
    name: doc.frontmatter.name,
    goal: doc.frontmatter.goal,
  };
  if (doc.frontmatter.requirements.length > 0) {
    ordered.requirements = doc.frontmatter.requirements;
  }
  if (doc.frontmatter.success_criteria.length > 0) {
    ordered.success_criteria = doc.frontmatter.success_criteria;
  }
  if (doc.frontmatter.pre_seeded) ordered.pre_seeded = true;
  const lines: string[] = [];
  lines.push(`# Phase ${doc.frontmatter.phase}: ${doc.frontmatter.name}`);
  lines.push('');
  lines.push(`**Goal:** ${doc.frontmatter.goal}`);
  lines.push('');
  if (doc.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    lines.push(doc.notes.trim());
    lines.push('');
  }
  if (doc.decisions.length > 0) {
    lines.push('## Decisions');
    lines.push('');
    lines.push(doc.decisions.trim());
    lines.push('');
  }
  if (doc.deferred_ideas.length > 0) {
    lines.push('## Deferred Ideas');
    lines.push('');
    lines.push(doc.deferred_ideas.trim());
    lines.push('');
  }
  return formatFrontmatter(ordered, lines.join('\n'));
}

export const MilestoneContextFrontmatterSchema = z.object({
  milestone_name: z.string().min(1),
  gathered: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  calibration: z.enum(['builder', 'architect']),
});

export type MilestoneContextFrontmatter = z.infer<typeof MilestoneContextFrontmatterSchema>;

export interface MilestoneContextDoc {
  readonly frontmatter: MilestoneContextFrontmatter;
  readonly scope_boundary: string;
  readonly decomposition_decisions: string;
  readonly scope_coverage: string;
  readonly requirement_mapping: string;
  readonly key_decisions: string;
  readonly deferred_ideas: string;
}

export function parseMilestoneContext(raw: string): MilestoneContextDoc {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  const fm = MilestoneContextFrontmatterSchema.parse(frontmatter);
  return {
    frontmatter: fm,
    scope_boundary: extractSection(body, 'Scope Boundary'),
    decomposition_decisions: extractSection(body, 'Decomposition Decisions'),
    scope_coverage: extractSubSection(body, 'Decomposition Decisions', 'Scope Coverage'),
    requirement_mapping: extractSection(body, 'Requirement Mapping'),
    key_decisions: extractSection(body, 'Key Decisions'),
    deferred_ideas: extractSection(body, 'Deferred Ideas'),
  };
}

export function renderMilestoneContext(doc: MilestoneContextDoc): string {
  const ordered: Record<string, unknown> = {
    milestone_name: doc.frontmatter.milestone_name,
    gathered: doc.frontmatter.gathered,
    calibration: doc.frontmatter.calibration,
  };
  const lines: string[] = [];
  lines.push(`# ${doc.frontmatter.milestone_name}`);
  lines.push('');
  if (doc.scope_boundary.length > 0) {
    lines.push('## Scope Boundary');
    lines.push('');
    lines.push(doc.scope_boundary.trim());
    lines.push('');
  }
  if (doc.decomposition_decisions.length > 0 || doc.scope_coverage.length > 0) {
    lines.push('## Decomposition Decisions');
    lines.push('');
    if (doc.decomposition_decisions.length > 0) {
      lines.push(doc.decomposition_decisions.trim());
      lines.push('');
    }
    if (doc.scope_coverage.length > 0) {
      lines.push('### Scope Coverage');
      lines.push('');
      lines.push(doc.scope_coverage.trim());
      lines.push('');
    }
  }
  if (doc.requirement_mapping.length > 0) {
    lines.push('## Requirement Mapping');
    lines.push('');
    lines.push(doc.requirement_mapping.trim());
    lines.push('');
  }
  if (doc.key_decisions.length > 0) {
    lines.push('## Key Decisions');
    lines.push('');
    lines.push(doc.key_decisions.trim());
    lines.push('');
  }
  if (doc.deferred_ideas.length > 0) {
    lines.push('## Deferred Ideas');
    lines.push('');
    lines.push(doc.deferred_ideas.trim());
    lines.push('');
  }
  return formatFrontmatter(ordered, lines.join('\n'));
}

function extractSection(body: string, heading: string): string {
  const re = new RegExp(`(^|\\n)##\\s+${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  const m = re.exec(body);
  return m === null ? '' : (m[2] ?? '').trim();
}

function extractSubSection(body: string, parent: string, child: string): string {
  const parentSection = extractSection(body, parent);
  const re = new RegExp(`(^|\\n)###\\s+${escapeRegex(child)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`);
  const m = re.exec(parentSection);
  return m === null ? '' : (m[2] ?? '').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function coerceBoolean(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (out[key] === 'true') out[key] = true;
  if (out[key] === 'false') out[key] = false;
  return out;
}
