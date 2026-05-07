import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

const AgentSchema = z.enum(['debugger', 'qa', 'dev']);
const StatusSchema = z.enum(['open', 'resolved', 'abandoned']);

export const DebugSessionFrontmatterSchema = z.object({
  session_id: z.string().min(1),
  started: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  agent: AgentSchema,
  phase: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  plan: z
    .string()
    .regex(/^\d{2}[a-z]?$/)
    .optional(),
  status: StatusSchema,
  summary: z.string().min(1),
});

export type DebugSessionFrontmatter = z.infer<typeof DebugSessionFrontmatterSchema>;

export interface DebugSessionDoc {
  readonly frontmatter: DebugSessionFrontmatter;
  readonly investigation: string;
  readonly findings: string;
  readonly resolution: string;
}

export function readDebugSession(raw: string): DebugSessionDoc {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  const fm = DebugSessionFrontmatterSchema.parse(frontmatter);
  return {
    frontmatter: fm,
    investigation: extractSection(body, 'Investigation'),
    findings: extractSection(body, 'Findings'),
    resolution: extractSection(body, 'Resolution'),
  };
}

export function writeDebugSession(doc: DebugSessionDoc): string {
  const ordered: Record<string, unknown> = {
    session_id: doc.frontmatter.session_id,
    started: doc.frontmatter.started,
    agent: doc.frontmatter.agent,
    ...(doc.frontmatter.phase !== undefined ? { phase: doc.frontmatter.phase } : {}),
    ...(doc.frontmatter.plan !== undefined ? { plan: doc.frontmatter.plan } : {}),
    status: doc.frontmatter.status,
    summary: doc.frontmatter.summary,
  };
  const lines: string[] = [];
  lines.push(`# Debug Session ${doc.frontmatter.session_id}`);
  lines.push('');
  lines.push('## Investigation');
  lines.push('');
  lines.push(doc.investigation.trim());
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  lines.push(doc.findings.trim());
  lines.push('');
  lines.push('## Resolution');
  lines.push('');
  lines.push(doc.resolution.trim());
  return formatFrontmatter(ordered, `${lines.join('\n')}\n`);
}

function extractSection(body: string, heading: string): string {
  const re = new RegExp(`(^|\\n)##\\s+${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  const m = re.exec(body);
  return m === null ? '' : (m[2] ?? '').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
