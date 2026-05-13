import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type {
  AgentLiveState,
  ArtifactKind,
  CodebaseProfile,
  CostSummary,
  MilestoneTodo,
  PlanSummary,
} from '@swt-labs/shared';

const PLANNING_DIR_NAME = '.swt-planning';
const PHASES_DIR_NAME = 'phases';

const ARTIFACT_KIND_PATTERNS: Array<{ pattern: RegExp; kind: ArtifactKind }> = [
  { pattern: /-?RESEARCH\.md$/i, kind: 'research' },
  { pattern: /-?PLAN\.md$/i, kind: 'plan' },
  { pattern: /-?SUMMARY\.md$/i, kind: 'summary' },
  { pattern: /-?VERIFICATION\.md$/i, kind: 'verification' },
  { pattern: /-?UAT\.md$/i, kind: 'uat' },
  { pattern: /-?CONTEXT\.md$/i, kind: 'context' },
];

export interface RawArtifact {
  name: string;
  abs_path: string;
  size_bytes: number;
  mtime: Date;
  kind: ArtifactKind | null;
}

export interface RawPhase {
  position: string;
  slug: string;
  abs_path: string;
  artifacts: RawArtifact[];
}

export interface RawScan {
  project_root: string;
  state_md: string | null;
  roadmap_md: string | null;
  project_md: string | null;
  phases: RawPhase[];
}

function tryReadText(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function classify(name: string): ArtifactKind | null {
  for (const { pattern, kind } of ARTIFACT_KIND_PATTERNS) {
    if (pattern.test(name)) return kind;
  }
  return null;
}

function listMarkdownAndJson(dir: string): RawArtifact[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: RawArtifact[] = [];
  for (const name of entries) {
    if (!/\.(md|json)$/i.test(name)) continue;
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    out.push({
      name,
      abs_path: abs,
      size_bytes: stats.size,
      mtime: stats.mtime,
      kind: classify(name),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const phaseDirNamePattern = /^(\d{2})-(.+)$/;

function listPhaseDirs(phasesRoot: string): RawPhase[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(phasesRoot);
  } catch {
    return [];
  }
  const out: RawPhase[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const match = phaseDirNamePattern.exec(name);
    if (!match) continue;
    const abs = path.join(phasesRoot, name);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    out.push({
      position: match[1] ?? '00',
      slug: name,
      abs_path: abs,
      artifacts: listMarkdownAndJson(abs),
    });
  }
  out.sort((a, b) => a.position.localeCompare(b.position));
  return out;
}

export function scan(projectRoot: string): RawScan {
  const planningDir = path.join(projectRoot, PLANNING_DIR_NAME);
  const phasesDir = path.join(planningDir, PHASES_DIR_NAME);

  return {
    project_root: projectRoot,
    state_md: tryReadText(path.join(planningDir, 'STATE.md')),
    roadmap_md: tryReadText(path.join(planningDir, 'ROADMAP.md')),
    project_md: tryReadText(path.join(planningDir, 'PROJECT.md')),
    phases: listPhaseDirs(phasesDir),
  };
}

/* ------------------------------------------------------------------ *
 * Plan 04-02 T2 — additional scanners for the 5-pane dashboard.
 *
 * These read the runtime substrate written by Phase 2 + plan 04-01:
 *   .swt-planning/.sessions/*.json   (Phase 2 agent-pid-tracker.sh)
 *   .swt-planning/.metrics/*.json    (plan 04-01 token-meter)
 *   .swt-planning/.events/*.jsonl    (plan 04-01 cook event channel)
 * ------------------------------------------------------------------ */

const SESSIONS_DIR_REL = path.join('.swt-planning', '.sessions');
const METRICS_DIR_REL = path.join('.swt-planning', '.metrics');
const EVENTS_DIR_REL = path.join('.swt-planning', '.events');

interface AgentSessionFile {
  pid?: number;
  role?: string;
  started_at?: string;
  status?: string;
  sub_session_id?: string;
  model?: string;
}

interface MetricsFile {
  session_id?: string;
  phase_slug?: string;
  tokens?: {
    in?: number;
    out?: number;
    cache_creation?: number;
    cache_read?: number;
  };
  cost_usd?: number;
  cache_hit_ratio?: number;
  last_updated?: string;
}

function listJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
}

function parseJsonSafe<T>(absPath: string): T | null {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Tail the last `n` JSONL lines of a file. Used to extract the most recent
 * `cook.tool_call` and any `cook.agent_result` usage for the active-agents
 * pane without loading the whole event log. Returns [] when the file is
 * absent or unreadable.
 */
function tailJsonlLines(absPath: string, n: number): string[] {
  if (!existsSync(absPath)) return [];
  let buf: string;
  try {
    buf = readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const lines = buf.split('\n').filter((l) => l.length > 0);
  return lines.slice(-n);
}

interface AgentEventTail {
  current_tool?: string;
  current_tool_input_excerpt?: string;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_creation: number;
  cost_usd: number;
}

function readAgentEventTail(projectRoot: string, subSessionId: string): AgentEventTail {
  const file = path.join(projectRoot, EVENTS_DIR_REL, `agent-${subSessionId}.jsonl`);
  const lines = tailJsonlLines(file, 20);
  const out: AgentEventTail = {
    tokens_in: 0,
    tokens_out: 0,
    cache_read: 0,
    cache_creation: 0,
    cost_usd: 0,
  };
  // Walk newest → oldest to find the most recent tool_call; accumulate usage
  // from every agent_result we see in the tail.
  let foundTool = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let row: unknown;
    try {
      row = JSON.parse(lines[i] ?? '');
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const ev = row as { type?: string; tool?: string; input_excerpt?: string; usage?: unknown };
    if (!foundTool && ev.type === 'cook.tool_call' && typeof ev.tool === 'string') {
      out.current_tool = ev.tool;
      if (typeof ev.input_excerpt === 'string') {
        out.current_tool_input_excerpt = ev.input_excerpt;
      }
      foundTool = true;
    }
    if (ev.type === 'cook.agent_result' && ev.usage && typeof ev.usage === 'object') {
      const u = ev.usage as {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        cost_usd?: number;
      };
      out.tokens_in += typeof u.input_tokens === 'number' ? u.input_tokens : 0;
      out.tokens_out += typeof u.output_tokens === 'number' ? u.output_tokens : 0;
      out.cache_read += typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0;
      out.cache_creation +=
        typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0;
      out.cost_usd += typeof u.cost_usd === 'number' ? u.cost_usd : 0;
    }
  }
  return out;
}

function coerceAgentStatus(raw: unknown): AgentLiveState['status'] {
  if (raw === 'idle' || raw === 'spawning' || raw === 'running' || raw === 'completed' || raw === 'failed') {
    return raw;
  }
  return 'running';
}

/**
 * Read `.swt-planning/.sessions/*.json` (Phase 2 agent-pid-tracker output),
 * fold in the latest cook event tail for each agent, and return an
 * `AgentLiveState[]` sorted by `started_at` descending.
 *
 * Pure read — no caching, no chokidar. The snapshotter re-invokes this on
 * every `state.changed` tick.
 */
export function scanActiveAgents(projectRoot: string): AgentLiveState[] {
  const sessionsDir = path.join(projectRoot, SESSIONS_DIR_REL);
  const files = listJsonFiles(sessionsDir);
  const now = Date.now();
  const agents: AgentLiveState[] = [];
  for (const file of files) {
    const abs = path.join(sessionsDir, file);
    const data = parseJsonSafe<AgentSessionFile>(abs);
    if (!data) continue;
    const subSessionId =
      typeof data.sub_session_id === 'string' && data.sub_session_id.length > 0
        ? data.sub_session_id
        : file.replace(/\.json$/, '');
    const role = typeof data.role === 'string' && data.role.length > 0 ? data.role : 'unknown';
    const startedAt =
      typeof data.started_at === 'string' && data.started_at.length > 0
        ? data.started_at
        : new Date().toISOString();
    const elapsedMs = (() => {
      const t = Date.parse(startedAt);
      return Number.isFinite(t) ? Math.max(0, now - t) : 0;
    })();
    const tail = readAgentEventTail(projectRoot, subSessionId);
    const agent: AgentLiveState = {
      sub_session_id: subSessionId,
      role,
      status: coerceAgentStatus(data.status),
      tokens_in: tail.tokens_in,
      tokens_out: tail.tokens_out,
      cache_read: tail.cache_read,
      cache_creation: tail.cache_creation,
      cost_usd: tail.cost_usd,
      elapsed_ms: elapsedMs,
      started_at: startedAt,
      ...(typeof data.model === 'string' ? { model: data.model } : {}),
      ...(typeof data.pid === 'number' ? { pid: data.pid } : {}),
      ...(tail.current_tool !== undefined ? { current_tool: tail.current_tool } : {}),
      ...(tail.current_tool_input_excerpt !== undefined
        ? { current_tool_input_excerpt: tail.current_tool_input_excerpt }
        : {}),
    };
    agents.push(agent);
  }
  agents.sort((a, b) => (b.started_at > a.started_at ? 1 : b.started_at < a.started_at ? -1 : 0));
  return agents;
}

export interface ScanCostSummaryOptions {
  /** When set, treat this session id as the "active session" for `this_session_usd`. */
  activeSessionId?: string;
  /** When set, look up `.metrics/phase-{slug}.json` for `this_phase_usd`. */
  currentPhaseSlug?: string;
  /** When set, sum only session files whose phase_slug matches. */
  milestonePhaseSlugs?: ReadonlyArray<string>;
}

/**
 * Read `.swt-planning/.metrics/*.json` (plan 04-01 token-meter output) and
 * roll up the Pane 4 cost breakdown. Returns null when the metrics dir is
 * missing — callers fall back to the zeroed legacy literal.
 */
export function scanCostSummary(
  projectRoot: string,
  opts: ScanCostSummaryOptions = {},
): CostSummary | null {
  const metricsDir = path.join(projectRoot, METRICS_DIR_REL);
  if (!existsSync(metricsDir)) return null;

  const sessionFiles = listJsonFiles(metricsDir).filter((n) => n.startsWith('session-'));
  if (sessionFiles.length === 0) return null;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  let totalUsd = 0;
  let todayUsd = 0;
  let milestoneUsd = 0;
  let activeSessionUsd = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheCreation = 0;
  let cacheRead = 0;
  const milestoneSet = new Set(opts.milestonePhaseSlugs ?? []);

  for (const name of sessionFiles) {
    const abs = path.join(metricsDir, name);
    const m = parseJsonSafe<MetricsFile>(abs);
    if (!m) continue;
    const cost = typeof m.cost_usd === 'number' ? m.cost_usd : 0;
    totalUsd += cost;
    tokensIn += m.tokens?.in ?? 0;
    tokensOut += m.tokens?.out ?? 0;
    cacheCreation += m.tokens?.cache_creation ?? 0;
    cacheRead += m.tokens?.cache_read ?? 0;
    const last = typeof m.last_updated === 'string' ? Date.parse(m.last_updated) : NaN;
    if (Number.isFinite(last) && now - last <= DAY_MS) {
      todayUsd += cost;
    }
    if (milestoneSet.size > 0 && typeof m.phase_slug === 'string' && milestoneSet.has(m.phase_slug)) {
      milestoneUsd += cost;
    }
    if (opts.activeSessionId !== undefined && m.session_id === opts.activeSessionId) {
      activeSessionUsd += cost;
    }
  }

  // Fall back to "total" when no milestone slug filter was supplied so the
  // legacy zero literal doesn't suddenly look like a regression.
  if (milestoneSet.size === 0) milestoneUsd = totalUsd;

  let thisPhaseUsd = 0;
  if (opts.currentPhaseSlug !== undefined) {
    const phaseFile = path.join(metricsDir, `phase-${opts.currentPhaseSlug}.json`);
    const m = parseJsonSafe<MetricsFile>(phaseFile);
    if (m && typeof m.cost_usd === 'number') thisPhaseUsd = m.cost_usd;
  }

  const denom = tokensIn + cacheCreation + cacheRead;
  const cacheHitRatio = denom > 0 ? cacheRead / denom : 0;

  const summary: CostSummary = {
    total_usd: totalUsd,
    today_usd: todayUsd,
    this_milestone_usd: milestoneUsd,
    this_phase_usd: thisPhaseUsd,
    this_session_usd: activeSessionUsd,
    cache_hit_ratio: cacheHitRatio,
    tokens: { in: tokensIn, out: tokensOut, cache_creation: cacheCreation, cache_read: cacheRead },
  };
  return summary;
}

/**
 * Heuristic disambiguation for "which session is active" when the dashboard
 * has no other signal: pick the most-recently-updated `session-*.json`. The
 * caller passes the result into `scanCostSummary({activeSessionId})` to
 * populate `this_session_usd`.
 */
export function pickActiveSessionId(projectRoot: string): string | undefined {
  const metricsDir = path.join(projectRoot, METRICS_DIR_REL);
  let best: { id: string; mtime: number } | null = null;
  for (const file of listJsonFiles(metricsDir)) {
    if (!file.startsWith('session-')) continue;
    const abs = path.join(metricsDir, file);
    try {
      const st = statSync(abs);
      const id = file.replace(/^session-/, '').replace(/\.json$/, '');
      if (best === null || st.mtimeMs > best.mtime) best = { id, mtime: st.mtimeMs };
    } catch {
      continue;
    }
  }
  return best?.id;
}

export interface ProjectExtensions {
  description?: string;
  codebase_profile?: CodebaseProfile;
  todos: MilestoneTodo[];
  blockers: MilestoneTodo[];
}

function matchInlineLabel(md: string, label: string): string | null {
  const re = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, 'mi');
  const m = re.exec(md);
  return m && m[1] ? m[1].trim() : null;
}

function matchListBlock(md: string, label: string): string[] {
  // Capture bullet items that immediately follow a `**Label:**` heading.
  const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\\n((?:\\s*-\\s+.+\\n?)+)`, 'i');
  const m = re.exec(md);
  if (!m || !m[1]) return [];
  return m[1]
    .split('\n')
    .map((line) => line.replace(/^\s*-\s+/, '').trim())
    .filter((line) => line.length > 0);
}

function todosFromList(lines: ReadonlyArray<string>): MilestoneTodo[] {
  const out: MilestoneTodo[] = [];
  for (const line of lines) {
    // Optional `[NN]` or `(NN-)` prefix → phase tag.
    const phaseMatch = /^\(?(\d{2})\)?\s*[:\-]?\s*(.+)$/.exec(line);
    if (phaseMatch && phaseMatch[2]) {
      out.push({ text: phaseMatch[2].trim(), phase: phaseMatch[1] });
    } else {
      out.push({ text: line });
    }
  }
  return out;
}

/**
 * Read STATE.md + PROJECT.md for the optional Pane 1 + milestone fields.
 * Best-effort string parsing — every output field is independently optional
 * so a malformed body cannot break the snapshot build.
 */
export function scanProjectExtensions(projectRoot: string): ProjectExtensions {
  const planningDir = path.join(projectRoot, PLANNING_DIR_NAME);
  const stateMd = tryReadText(path.join(planningDir, 'STATE.md')) ?? '';
  const projectMd = tryReadText(path.join(planningDir, 'PROJECT.md')) ?? '';
  const out: ProjectExtensions = { todos: [], blockers: [] };

  const description =
    matchInlineLabel(projectMd, 'Description') ?? matchInlineLabel(stateMd, 'Description');
  if (description) out.description = description;

  const stack = matchInlineLabel(projectMd, 'Stack') ?? matchInlineLabel(stateMd, 'Stack');
  const languagesRaw =
    matchInlineLabel(projectMd, 'Languages') ?? matchInlineLabel(stateMd, 'Languages');
  const locRaw = matchInlineLabel(projectMd, 'LOC') ?? matchInlineLabel(stateMd, 'LOC');
  const profile: CodebaseProfile = {};
  if (stack) profile.stack = stack;
  if (languagesRaw) {
    profile.languages = languagesRaw
      .split(/[,/]\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (locRaw) {
    const n = Number.parseInt(locRaw.replace(/[,_\s]/g, ''), 10);
    if (Number.isFinite(n) && n >= 0) profile.loc = n;
  }
  if (Object.keys(profile).length > 0) out.codebase_profile = profile;

  out.todos = todosFromList(matchListBlock(stateMd, 'Todos'));
  out.blockers = todosFromList(matchListBlock(stateMd, 'Blockers'));
  return out;
}

/* ----- per-phase plan summaries (PhaseSummary.plans) ----- */

const PLAN_FILE_PATTERN = /^(\d{2}-\d{2})-PLAN\.md$/i;

function readPlanFrontmatter(absPath: string, planId: string): PlanSummary | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  if (!text.startsWith('---')) return null;
  const endIdx = text.indexOf('\n---', 3);
  if (endIdx < 0) return null;
  const fm = text.slice(3, endIdx);
  const getField = (key: string): string | null => {
    const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm');
    const m = re.exec(fm);
    if (!m || !m[1]) return null;
    return m[1].replace(/^['"]|['"]$/g, '').trim();
  };
  const title = getField('title') ?? planId;
  const waveRaw = getField('wave');
  const wave = waveRaw !== null ? Number.parseInt(waveRaw, 10) : NaN;
  const statusRaw = getField('status');
  const summary: PlanSummary = { plan: planId, title };
  if (Number.isFinite(wave) && wave >= 0) summary.wave = wave;
  if (statusRaw === 'pending' || statusRaw === 'in_progress' || statusRaw === 'complete' || statusRaw === 'failed') {
    summary.status = statusRaw;
  }
  return summary;
}

/**
 * For a single phase directory, find all `NN-MM-PLAN.md` files and parse
 * their frontmatter into a `PlanSummary[]` sorted by `plan` ascending.
 */
export function scanPlansInPhaseDir(phaseAbsPath: string): PlanSummary[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(phaseAbsPath);
  } catch {
    return [];
  }
  const plans: PlanSummary[] = [];
  for (const name of entries) {
    const m = PLAN_FILE_PATTERN.exec(name);
    if (!m || !m[1]) continue;
    const planId = m[1];
    const summary = readPlanFrontmatter(path.join(phaseAbsPath, name), planId);
    if (summary) plans.push(summary);
  }
  plans.sort((a, b) => a.plan.localeCompare(b.plan));
  return plans;
}
