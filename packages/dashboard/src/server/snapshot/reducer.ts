import { readFileSync } from 'node:fs';

import {
  type ArtifactSummary,
  type PhaseState,
  type PhaseSummary,
  type QaStatus,
  SnapshotSchema,
  type Snapshot,
} from '@swt-labs/shared';

import { type RawArtifact, type RawPhase, scan } from './scanner.js';

interface PhaseHints {
  has_plan: boolean;
  has_summary: boolean;
  has_verification: boolean;
  has_uat: boolean;
  has_context: boolean;
  verification_text: string | null;
  uat_text: string | null;
}

function summarizeArtifacts(artifacts: RawArtifact[]): {
  hints: PhaseHints;
  summaries: ArtifactSummary[];
} {
  const summaries: ArtifactSummary[] = [];
  const hints: PhaseHints = {
    has_plan: false,
    has_summary: false,
    has_verification: false,
    has_uat: false,
    has_context: false,
    verification_text: null,
    uat_text: null,
  };
  for (const a of artifacts) {
    if (!a.kind) continue;
    summaries.push({
      name: a.name,
      kind: a.kind,
      size_bytes: a.size_bytes,
      mtime: a.mtime.toISOString(),
    });
    if (a.kind === 'plan') hints.has_plan = true;
    if (a.kind === 'summary') hints.has_summary = true;
    if (a.kind === 'verification') hints.has_verification = true;
    if (a.kind === 'uat') hints.has_uat = true;
    if (a.kind === 'context') hints.has_context = true;
  }
  return { hints, summaries };
}

function frontmatterValue(text: string, key: string): string | null {
  const start = text.indexOf('---');
  if (start !== 0) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const block = text.slice(3, end);
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm');
  const m = re.exec(block);
  if (!m) return null;
  return (m[1] ?? '').replace(/^['"]|['"]$/g, '');
}

function derivePhaseState(hints: PhaseHints): PhaseState {
  if (hints.has_uat) return 'all_done';
  if (hints.has_verification) return 'needs_verification';
  if (hints.has_summary) return 'needs_verification';
  if (hints.has_plan) return 'needs_execute';
  if (hints.has_context) return 'needs_plan_and_execute';
  return 'needs_discussion';
}

function deriveQaStatus(hints: PhaseHints): QaStatus {
  if (!hints.has_verification) return 'none';
  if (!hints.verification_text) return 'pending';
  const result = frontmatterValue(hints.verification_text, 'result');
  if (!result) return 'pending';
  if (/^pass$/i.test(result)) return 'passed';
  if (/^fail$/i.test(result)) return 'failed';
  if (/^partial$/i.test(result)) return 'failed';
  return 'pending';
}

function extractPhaseName(phaseSlug: string, roadmapMd: string | null, position: string): string {
  if (!roadmapMd) {
    return phaseSlug.replace(/^\d+-/, '').replace(/-/g, ' ');
  }
  const phaseNum = Number.parseInt(position, 10);
  const re = new RegExp(`^##\\s+Phase\\s+${phaseNum}\\s*[:\\-]?\\s*(.+?)\\s*$`, 'mi');
  const m = re.exec(roadmapMd);
  if (m) return (m[1] ?? '').trim();
  return phaseSlug.replace(/^\d+-/, '').replace(/-/g, ' ');
}

function extractPhaseGoal(roadmapMd: string | null, position: string): string | undefined {
  if (!roadmapMd) return undefined;
  const phaseNum = Number.parseInt(position, 10);
  const re = new RegExp(
    `##\\s+Phase\\s+${phaseNum}\\b[\\s\\S]*?\\*\\*Goal:\\*\\*\\s*(.+?)\\s*\\n\\n`,
    'i',
  );
  const m = re.exec(roadmapMd);
  return m && m[1] ? m[1].trim() : undefined;
}

function extractFromState(stateMd: string | null, label: string): string | null {
  if (!stateMd) return null;
  const re = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, 'mi');
  const m = re.exec(stateMd);
  return m && m[1] ? m[1].trim() : null;
}

function extractCurrentPhaseIndex(stateMd: string | null): number {
  if (!stateMd) return 1;
  const re = /^Phase:\s*(\d+)\s*of\s*(\d+)/im;
  const m = re.exec(stateMd);
  if (!m || !m[1]) return 1;
  return Number.parseInt(m[1], 10);
}

function buildPhaseSummary(
  rawPhase: RawPhase,
  roadmapMd: string | null,
): { summary: PhaseSummary; hints: PhaseHints } {
  const verifArtifact = rawPhase.artifacts.find((a) => a.kind === 'verification');
  const uatArtifact = rawPhase.artifacts.find((a) => a.kind === 'uat');

  const hints: PhaseHints = {
    has_plan: rawPhase.artifacts.some((a) => a.kind === 'plan'),
    has_summary: rawPhase.artifacts.some((a) => a.kind === 'summary'),
    has_verification: !!verifArtifact,
    has_uat: !!uatArtifact,
    has_context: rawPhase.artifacts.some((a) => a.kind === 'context'),
    verification_text: null,
    uat_text: null,
  };

  if (verifArtifact) {
    try {
      hints.verification_text = readFileSync(verifArtifact.abs_path, 'utf8');
    } catch {
      // ignore — qa_status falls back to 'pending'
    }
  }

  const { summaries } = summarizeArtifacts(rawPhase.artifacts);
  const goal = extractPhaseGoal(roadmapMd, rawPhase.position);

  const summary: PhaseSummary = {
    position: rawPhase.position,
    slug: rawPhase.slug,
    name: extractPhaseName(rawPhase.slug, roadmapMd, rawPhase.position),
    state: derivePhaseState(hints),
    qa_status: deriveQaStatus(hints),
    artifacts: summaries,
    ...(goal !== undefined ? { goal } : {}),
  };
  return { summary, hints };
}

export function buildSnapshot(projectRoot: string): Snapshot {
  const raw = scan(projectRoot);
  const phases = raw.phases.map((p) => buildPhaseSummary(p, raw.roadmap_md).summary);

  const projectName =
    extractFromState(raw.state_md, 'Project') ??
    (raw.project_md ? (raw.project_md.split('\n')[0] ?? '').replace(/^#\s*/, '').trim() : null) ??
    'unknown';

  const milestoneName = extractFromState(raw.state_md, 'Milestone') ?? 'unknown';

  const snapshot: Snapshot = {
    schema_version: '1',
    generated_at: new Date().toISOString(),
    project: {
      name: projectName,
      root: projectRoot,
      backend: 'pi',
    },
    milestone: {
      name: milestoneName,
      phase_count: phases.length,
      phase_index: extractCurrentPhaseIndex(raw.state_md),
    },
    phases,
    active_agent: null,
    recent_events: [],
    cost_summary: {
      total_usd: 0,
      today_usd: 0,
      this_milestone_usd: 0,
    },
    is_initialized: true,
  };

  return SnapshotSchema.parse(snapshot);
}
