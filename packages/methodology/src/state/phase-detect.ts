import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_CONFIG, parseConfig, type SwtConfig } from '@swt-labs/core';

import { classifyPhase, type QaFreshnessResult } from './classify-phase.js';
import { scanMilestoneUat } from './milestone-uat.js';
import { checkQaFreshness } from './qa-freshness.js';
import { scanPhases } from './scan-phases.js';
import type {
  ExecutionState,
  PhaseDetectResult,
  PhaseSnapshot,
  QaAttentionStatus,
  QaStatus,
} from './types.js';

export interface DetectPhaseOptions {
  /** Repository working directory. Defaults to process.cwd(). */
  readonly cwd?: string;
  /**
   * Planning directory name. Defaults to '.swt-planning'; the resolver also
   * recognises '.vbw-planning' for projects migrating from VBW.
   */
  readonly planningDirName?: string;
  /** Override git binary (default 'git'). */
  readonly gitBin?: string;
  /** When false, skip git rev-parse calls (useful for hermetic tests). */
  readonly allowGit?: boolean;
}

/**
 * Pre-compute every routing key the orchestrator needs. Mirrors VBW's
 * `phase-detect.sh` output 1:1 for the keys the bash script emits.
 */
export async function detectPhase(opts: DetectPhaseOptions = {}): Promise<PhaseDetectResult> {
  const cwd = opts.cwd ?? process.cwd();
  const planningDir = await resolvePlanningDir(cwd, opts.planningDirName);
  const planningDirExists = planningDir !== undefined;

  const phasesDir = planningDirExists
    ? join(planningDir, 'phases')
    : `${opts.planningDirName ?? '.swt-planning'}/phases`;

  const projectExists = planningDirExists
    ? await fileExists(join(planningDir, 'PROJECT.md'))
    : false;

  const config = planningDirExists ? await loadConfig(planningDir) : DEFAULT_CONFIG;

  const phases = planningDirExists ? await scanPhases(planningDir) : [];
  const milestoneScan = planningDirExists
    ? await scanMilestoneUat(planningDir)
    : { issues: [], major_or_higher: false };

  // Compute classifications for each phase.
  const classifications: { snapshot: PhaseSnapshot; state: ReturnType<typeof classifyPhase> }[] =
    [];
  for (const snapshot of phases) {
    const freshness: QaFreshnessResult = await checkQaFreshness({
      verification: snapshot.verification,
      cwd,
      gitBin: opts.gitBin,
      allowGit: opts.allowGit,
    });
    classifications.push({
      snapshot,
      state: classifyPhase({
        snapshot,
        requirePhaseDiscussion:
          config.autonomy === 'cautious' || readFlag(config, 'require_phase_discussion'),
        autoUat: config.auto_uat,
        qaFreshness: freshness,
      }),
    });
  }

  // First non-`all_done` classification drives routing.
  const firstActionable = classifications.find(({ state }) => state.state !== 'all_done');
  const firstUnverified = classifications.find(
    ({ snapshot }) =>
      snapshot.planCount > 0 &&
      snapshot.summaryCount >= snapshot.planCount &&
      (snapshot.uat === undefined || snapshot.uat.status !== 'complete'),
  );
  const firstQaAttention = classifications.find(
    ({ state }) =>
      state.qaStatus === 'pending' ||
      state.qaStatus === 'failed' ||
      state.qaStatus === 'remediating',
  );

  // Resolve aggregate next_phase_state.
  let nextPhaseState: PhaseDetectResult['next_phase_state'];
  if (phases.length === 0) nextPhaseState = 'phase_count_zero';
  else if (firstActionable !== undefined) nextPhaseState = firstActionable.state.state;
  else nextPhaseState = 'all_done';

  const nextSnapshot = firstActionable?.snapshot ?? phases[phases.length - 1];

  // UAT issue aggregate over the whole roadmap.
  const uatIssuesPhases = phases.filter((p) => p.uat?.status === 'issues_found');
  const uatIssuesMajor =
    uatIssuesPhases.some((p) => p.uat?.major_or_higher) ||
    (firstActionable?.snapshot.uat?.major_or_higher ?? false);

  const milestoneUatIssues = milestoneScan.issues.length > 0;

  const qaStatus: QaStatus = firstActionable?.state.qaStatus ?? 'none';
  const qaReason = firstActionable?.state.qaReason ?? '';
  const qaAttentionStatus: QaAttentionStatus =
    firstQaAttention?.state.qaStatus === 'pending'
      ? 'pending'
      : firstQaAttention?.state.qaStatus === 'failed' ||
          firstQaAttention?.state.qaStatus === 'remediating'
        ? 'failed'
        : 'none';

  return {
    jq_available: true,
    planning_dir_exists: planningDirExists,
    project_exists: projectExists,
    phases_dir: phasesDir,
    has_shipped_milestones:
      milestoneScan.issues.length > 0 || (await hasShippedMilestones(planningDir)),
    needs_milestone_rename: false,
    phase_count: phases.length,
    next_phase: nextSnapshot?.position,
    next_phase_slug: nextSnapshot ? `${nextSnapshot.position}-${nextSnapshot.slug}` : undefined,
    next_phase_state: nextPhaseState,
    next_phase_plans: nextSnapshot?.planCount ?? 0,
    next_phase_summaries: nextSnapshot?.summaryCount ?? 0,
    has_unverified_phases: firstUnverified !== undefined,
    first_unverified_phase: firstUnverified?.snapshot.position,
    first_unverified_slug: firstUnverified
      ? `${firstUnverified.snapshot.position}-${firstUnverified.snapshot.slug}`
      : undefined,
    first_qa_attention_phase: firstQaAttention?.snapshot.position,
    first_qa_attention_slug: firstQaAttention
      ? `${firstQaAttention.snapshot.position}-${firstQaAttention.snapshot.slug}`
      : undefined,
    qa_attention_status: qaAttentionStatus,
    qa_attention_reason: firstQaAttention?.state.qaReason ?? 'none',
    qa_status: qaStatus,
    qa_reason: qaReason,
    qa_round: firstActionable?.snapshot.qaRemediation?.round ?? '00',
    uat_issues_phase: uatIssuesPhases[0]?.position ?? 'none',
    uat_issues_slug: uatIssuesPhases[0]
      ? `${uatIssuesPhases[0].position}-${uatIssuesPhases[0].slug}`
      : 'none',
    uat_issues_major_or_higher: uatIssuesMajor,
    uat_issues_phases: uatIssuesPhases.map((p) => `${p.position}-${p.slug}`).join('|'),
    uat_issues_count: uatIssuesPhases.length,
    uat_file: nextSnapshot?.uat?.filename ?? 'none',
    uat_round_count: 0, // TODO: count round dirs in remediation/uat/
    misnamed_plans: false, // TODO: detect filename drift
    milestone_uat_issues: milestoneUatIssues,
    milestone_uat_phase: milestoneScan.issues[0]?.phasePosition ?? 'none',
    milestone_uat_slug: milestoneScan.issues[0]?.milestoneSlug ?? 'none',
    milestone_uat_major_or_higher: milestoneScan.major_or_higher,
    milestone_uat_phase_dir: milestoneScan.issues[0]?.phaseDir ?? 'none',
    milestone_uat_count: milestoneScan.issues.length,
    milestone_uat_phase_dirs: milestoneScan.issues.map((p) => p.phaseDir).join('|'),
    config_effort: config.effort,
    config_autonomy: config.autonomy,
    config_auto_commit: readFlag(config, 'auto_commit', true),
    config_planning_tracking: config.planning_tracking,
    config_auto_push: config.auto_push,
    config_verification_tier: config.verification_tier,
    config_prefer_teams: config.prefer_teams,
    config_max_tasks_per_plan: readNumber(config, 'max_tasks_per_plan', 5),
    config_context_compiler: readFlag(config, 'context_compiler', true),
    config_require_phase_discussion: readFlag(config, 'require_phase_discussion'),
    config_auto_uat: config.auto_uat,
    config_compaction_threshold: readNumber(config, 'compaction_threshold', 130000),
    has_codebase_map: planningDirExists
      ? await fileExists(join(planningDir, 'codebase', 'META.md'))
      : false,
    brownfield: false, // TODO: detect from sibling source files
    execution_state: 'none' as ExecutionState,
    phase_detect_complete: true as const,
  };
}

async function resolvePlanningDir(
  cwd: string,
  override: string | undefined,
): Promise<string | undefined> {
  const candidates = override !== undefined ? [override] : ['.swt-planning', '.vbw-planning'];
  for (const name of candidates) {
    const candidate = join(cwd, name);
    const st = await stat(candidate).catch(() => undefined);
    if (st !== undefined && st.isDirectory()) return candidate;
  }
  return undefined;
}

async function fileExists(path: string): Promise<boolean> {
  const st = await stat(path).catch(() => undefined);
  return st !== undefined && st.isFile();
}

async function hasShippedMilestones(planningDir: string | undefined): Promise<boolean> {
  if (planningDir === undefined) return false;
  const milestonesDir = join(planningDir, 'milestones');
  const st = await stat(milestonesDir).catch(() => undefined);
  return st !== undefined && st.isDirectory();
}

async function loadConfig(planningDir: string): Promise<SwtConfig> {
  const path = join(planningDir, 'config.json');
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseConfig(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function readFlag(config: SwtConfig, key: string, fallback = false): boolean {
  const value = (config as unknown as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(config: SwtConfig, key: string, fallback: number): number {
  const value = (config as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
