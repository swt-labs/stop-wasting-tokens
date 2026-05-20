import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type ArtifactSummary,
  type PhaseState,
  type PhaseSummary,
  type QaStatus,
  SnapshotSchema,
  type Snapshot,
} from '@swt-labs/shared';

import { detectGitInfo } from './git-info.js';
import {
  pickActiveSessionId,
  type RawArtifact,
  type RawPhase,
  scan,
  scanActiveAgents,
  scanCostSummary,
  scanPlansInPhaseDir,
  scanProjectExtensions,
} from './scanner.js';

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
  const plans = scanPlansInPhaseDir(rawPhase.abs_path);

  const summary: PhaseSummary = {
    position: rawPhase.position,
    slug: rawPhase.slug,
    name: extractPhaseName(rawPhase.slug, roadmapMd, rawPhase.position),
    state: derivePhaseState(hints),
    qa_status: deriveQaStatus(hints),
    artifacts: summaries,
    ...(goal !== undefined ? { goal } : {}),
    ...(plans.length > 0 ? { plans } : {}),
  };
  return { summary, hints };
}

/**
 * Plan 04-02 T2 — derive `milestone.percent_complete` from per-phase QA
 * status. Passed/remediated count as 1.0, failed as 0.0, others as a
 * fractional in-progress weight so the bar advances as phases mature.
 */
function computePercentComplete(phases: ReadonlyArray<PhaseSummary>): number {
  if (phases.length === 0) return 0;
  let sum = 0;
  for (const p of phases) {
    if (p.qa_status === 'passed' || p.qa_status === 'remediated') {
      sum += 1;
    } else if (p.state === 'all_done') {
      sum += 1;
    } else if (p.state === 'needs_verification') {
      sum += 0.75;
    } else if (p.state === 'needs_execute') {
      sum += 0.4;
    } else if (p.state === 'needs_plan_and_execute') {
      sum += 0.15;
    }
  }
  return Math.max(0, Math.min(1, sum / phases.length));
}

export function buildSnapshot(projectRoot: string): Snapshot {
  const raw = scan(projectRoot);
  const phases = raw.phases.map((p) => buildPhaseSummary(p, raw.roadmap_md).summary);

  const projectName =
    extractFromState(raw.state_md, 'Project') ??
    (raw.project_md ? (raw.project_md.split('\n')[0] ?? '').replace(/^#\s*/, '').trim() : null) ??
    'unknown';

  const milestoneName = extractFromState(raw.state_md, 'Milestone') ?? 'unknown';

  // Plan 04-02 T2 — fold in the new substrate.
  const extensions = scanProjectExtensions(projectRoot);
  const activeAgents = scanActiveAgents(projectRoot);
  const activeSessionId = pickActiveSessionId(projectRoot);
  const milestoneSlugs = phases.map((p) => p.slug);
  const currentPhase = phases.find(
    (p) => Number.parseInt(p.position, 10) === extractCurrentPhaseIndex(raw.state_md),
  );
  const cost = scanCostSummary(projectRoot, {
    ...(activeSessionId !== undefined ? { activeSessionId } : {}),
    ...(currentPhase ? { currentPhaseSlug: currentPhase.slug } : {}),
    milestonePhaseSlugs: milestoneSlugs,
  });

  const project: Snapshot['project'] = {
    name: projectName,
    root: projectRoot,
    backend: 'pi',
    ...(extensions.description !== undefined ? { description: extensions.description } : {}),
    ...(extensions.codebase_profile !== undefined
      ? { codebase_profile: extensions.codebase_profile }
      : {}),
  };

  const milestone: Snapshot['milestone'] = {
    name: milestoneName,
    phase_count: phases.length,
    phase_index: extractCurrentPhaseIndex(raw.state_md),
    percent_complete: computePercentComplete(phases),
    ...(extensions.todos.length > 0 ? { todos: extensions.todos } : {}),
    ...(extensions.blockers.length > 0 ? { blockers: extensions.blockers } : {}),
  };

  // Milestone 23 Phase 03 — derive the brownfield + codebase_mapped
  // flags from filesystem presence. `stack.json` is the canonical
  // brownfield signal Phase 01's `detect-stack.sh` writes for brownfield
  // projects; `.swt-planning/codebase/` is the directory the 4 Scout
  // agents populate when `swt map` runs. Both fields are ALWAYS set
  // explicitly here (no `undefined` in the post-init path); the schema's
  // `.optional()` is purely defensive for old wire snapshots + test
  // fixtures that omit them (PA-2).
  const brownfield = existsSync(path.join(projectRoot, '.swt-planning', 'stack.json'));
  const codebase_mapped = existsSync(path.join(projectRoot, '.swt-planning', 'codebase'));

  // Statusline v2 Wave 5 commit 9 — project-identity payload for the
  // leftmost `repo:` + `branch:` statusline cells. `detectGitInfo`
  // returns `undefined` for non-git workspaces; the consumer renders
  // its Project group only when the field is present.
  const git = detectGitInfo(projectRoot);

  const snapshot: Snapshot = {
    schema_version: '1',
    generated_at: new Date().toISOString(),
    project,
    milestone,
    phases,
    active_agents: activeAgents,
    recent_events: [],
    cost_summary: cost ?? {
      total_usd: 0,
      today_usd: 0,
      this_milestone_usd: 0,
    },
    is_initialized: true,
    brownfield,
    codebase_mapped,
    ...(git !== undefined ? { git } : {}),
  };

  return SnapshotSchema.parse(snapshot);
}
