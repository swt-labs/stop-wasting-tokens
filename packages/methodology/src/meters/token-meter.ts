/**
 * Plan 04-01 (Phase 4) T3 — Token-cost meter file aggregator.
 *
 * Research §3.4 option B: each agent_result `usage` payload is folded into
 * a rolling JSON aggregate per session (and optionally per phase). The
 * dashboard reducer (plan 04-02) reads these files to populate the
 * `cost_summary` panel; the statusline (plan 04-04) reads the same files
 * for its tokens / cost lines.
 *
 * R5 (combined live events + file aggregator): cook.ts emits a
 * `cook.agent_result` SSE event for every spawn (live tokens pane) AND
 * calls `recordUsage` here for the rolling aggregate. Both must exist —
 * the live event drives real-time updates, the file is the durable
 * post-run cost source.
 *
 * Cost compute: if Pi's `usage.cost_usd` is present, we use it directly.
 * If absent, `cost_usd` stays at 0 — plan 04-04 / Phase 5 will compute
 * USD from `config/model-profiles.json` rate cards once Pi's usage shape
 * stabilises. Doing rate-card lookup here would couple this plan to the
 * Phase 5 deliverable (research §Recommendation 5 — spillover risk).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface UsageRecord {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cost_usd?: number;
}

export interface SessionMetrics {
  session_id: string;
  phase_slug?: string;
  agent_results: number;
  tokens: {
    in: number;
    out: number;
    cache_creation: number;
    cache_read: number;
  };
  cost_usd: number;
  cache_hit_ratio: number;
  last_updated: string;
}

export interface RecordUsageOptions {
  readonly sessionId: string;
  readonly phaseSlug?: string;
  readonly usage: UsageRecord;
  readonly planningRoot?: string;
}

function resolveMetricsDir(planningRoot?: string): string {
  const root = planningRoot ?? path.join(process.cwd(), '.swt-planning');
  return path.join(root, '.metrics');
}

function emptyMetrics(sessionId: string, phaseSlug?: string): SessionMetrics {
  return {
    session_id: sessionId,
    ...(phaseSlug !== undefined ? { phase_slug: phaseSlug } : {}),
    agent_results: 0,
    tokens: { in: 0, out: 0, cache_creation: 0, cache_read: 0 },
    cost_usd: 0,
    cache_hit_ratio: 0,
    last_updated: '',
  };
}

function loadMetrics(file: string, sessionId: string, phaseSlug?: string): SessionMetrics {
  if (!fs.existsSync(file)) return emptyMetrics(sessionId, phaseSlug);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionMetrics;
    // Defensive: a partial / corrupt file should not poison the next
    // recordUsage call. Reseed missing keys.
    return {
      session_id: parsed.session_id ?? sessionId,
      ...(parsed.phase_slug !== undefined ? { phase_slug: parsed.phase_slug } : {}),
      agent_results: typeof parsed.agent_results === 'number' ? parsed.agent_results : 0,
      tokens: {
        in: parsed.tokens?.in ?? 0,
        out: parsed.tokens?.out ?? 0,
        cache_creation: parsed.tokens?.cache_creation ?? 0,
        cache_read: parsed.tokens?.cache_read ?? 0,
      },
      cost_usd: typeof parsed.cost_usd === 'number' ? parsed.cost_usd : 0,
      cache_hit_ratio: typeof parsed.cache_hit_ratio === 'number' ? parsed.cache_hit_ratio : 0,
      last_updated: parsed.last_updated ?? '',
    };
  } catch {
    return emptyMetrics(sessionId, phaseSlug);
  }
}

function fold(prev: SessionMetrics, usage: UsageRecord): SessionMetrics {
  const next: SessionMetrics = {
    ...prev,
    agent_results: prev.agent_results + 1,
    tokens: {
      in: prev.tokens.in + usage.input_tokens,
      out: prev.tokens.out + usage.output_tokens,
      cache_creation: prev.tokens.cache_creation + (usage.cache_creation_input_tokens ?? 0),
      cache_read: prev.tokens.cache_read + (usage.cache_read_input_tokens ?? 0),
    },
    cost_usd: prev.cost_usd + (usage.cost_usd ?? 0),
    cache_hit_ratio: 0,
    last_updated: new Date().toISOString(),
  };
  const denom = next.tokens.in + next.tokens.cache_creation + next.tokens.cache_read;
  next.cache_hit_ratio = denom > 0 ? next.tokens.cache_read / denom : 0;
  return next;
}

/**
 * Record a single agent_result usage delta. Writes-through to
 * `.swt-planning/.metrics/session-{sessionId}.json` and, when
 * `phaseSlug` is provided, also folds into
 * `.swt-planning/.metrics/phase-{phaseSlug}.json`.
 *
 * Pure file I/O — no in-memory caching that would diverge across
 * concurrent cook invocations.
 */
export function recordUsage(opts: RecordUsageOptions): SessionMetrics {
  const metricsDir = resolveMetricsDir(opts.planningRoot);
  fs.mkdirSync(metricsDir, { recursive: true });

  const sessionFile = path.join(metricsDir, `session-${opts.sessionId}.json`);
  const sessionPrev = loadMetrics(sessionFile, opts.sessionId, opts.phaseSlug);
  const sessionNext = fold(sessionPrev, opts.usage);
  fs.writeFileSync(sessionFile, JSON.stringify(sessionNext, null, 2));

  if (opts.phaseSlug !== undefined) {
    const phaseFile = path.join(metricsDir, `phase-${opts.phaseSlug}.json`);
    // The phase aggregator pretends each session_id is the phase slug —
    // the consumer only reads tokens / cost / cache_hit_ratio, so the
    // session_id field is a label, not a primary key.
    const phasePrev = loadMetrics(phaseFile, opts.phaseSlug, opts.phaseSlug);
    const phaseNext = fold(phasePrev, opts.usage);
    fs.writeFileSync(phaseFile, JSON.stringify(phaseNext, null, 2));
  }

  return sessionNext;
}

export function readSessionMetrics(
  sessionId: string,
  planningRoot?: string,
): SessionMetrics | null {
  const file = path.join(resolveMetricsDir(planningRoot), `session-${sessionId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionMetrics;
  } catch {
    return null;
  }
}

export function readPhaseMetrics(
  phaseSlug: string,
  planningRoot?: string,
): SessionMetrics | null {
  const file = path.join(resolveMetricsDir(planningRoot), `phase-${phaseSlug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionMetrics;
  } catch {
    return null;
  }
}
