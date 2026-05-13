import {
  CommandBodySchema,
  CommandRegistrySchema,
  CommandResponseSchema,
  ConfigSnapshotSchema,
  ConfigUpdateBodySchema,
  ConfigUpdateResponseSchema,
  DetectPhaseReportSchema,
  DoctorReportSchema,
  HealthResponseSchema,
  InitBodySchema,
  InitResponseSchema,
  SnapshotSchema,
  UatCheckpointBodySchema,
  UatCheckpointResponseSchema,
  UpdateApplyResponseSchema,
  UpdateReportSchema,
  VibeReplyBodySchema,
  VibeReplyResponseSchema,
  VibeStartBodySchema,
  VibeStartResponseSchema,
  type CommandBody,
  type CommandRegistry,
  type CommandResponse,
  type CommandSpec,
  type ConfigSnapshot,
  type ConfigUpdateBody,
  type ConfigUpdateResponse,
  type DetectPhaseReport,
  type DoctorReport,
  type HealthResponse,
  type InitBody,
  type InitResponse,
  type Snapshot,
  type UatCheckpointBody,
  type UatCheckpointResponse,
  type UpdateApplyResponse,
  type UpdateReport,
  type VibeReplyBody,
  type VibeReplyResponse,
  type VibeStartBody,
  type VibeStartResponse,
} from '@swt-labs/shared';

export type {
  CommandBody,
  CommandRegistry,
  CommandResponse,
  CommandSpec,
  ConfigSnapshot,
  ConfigUpdateBody,
  ConfigUpdateResponse,
  DetectPhaseReport,
  DoctorReport,
  InitBody,
  InitResponse,
  UatCheckpointBody,
  UatCheckpointResponse,
  UpdateApplyResponse,
  UpdateReport,
  VibeReplyBody,
  VibeReplyResponse,
  VibeStartBody,
  VibeStartResponse,
};

export interface RenderedArtifact {
  html: string;
  frontmatter: Record<string, unknown>;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function jsonRequest<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const raw = await jsonRequest<unknown>('/api/health');
  return HealthResponseSchema.parse(raw);
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const raw = await jsonRequest<unknown>('/api/snapshot');
  return SnapshotSchema.parse(raw);
}

/* ── v2.3: read-only CLI parity routes ─────────────────────────────────
 * Each fetcher is a thin GET wrapper around its server-side route from
 * Phase 01. Validates the response through the matching schema in
 * @swt-labs/shared so panel components see fully-typed data
 * (and any wire-protocol drift surfaces here, not in the panel JSX).
 */

export async function fetchConfig(): Promise<ConfigSnapshot> {
  const raw = await jsonRequest<unknown>('/api/config');
  return ConfigSnapshotSchema.parse(raw);
}

export async function fetchDoctor(): Promise<DoctorReport> {
  const raw = await jsonRequest<unknown>('/api/doctor');
  return DoctorReportSchema.parse(raw);
}

export async function fetchDetectPhase(): Promise<DetectPhaseReport> {
  const raw = await jsonRequest<unknown>('/api/detect-phase');
  return DetectPhaseReportSchema.parse(raw);
}

export async function fetchUpdate(): Promise<UpdateReport> {
  const raw = await jsonRequest<unknown>('/api/update');
  return UpdateReportSchema.parse(raw);
}

export async function fetchCommands(): Promise<CommandRegistry> {
  const raw = await jsonRequest<unknown>('/api/commands');
  return CommandRegistrySchema.parse(raw);
}

/* ── v2.3 Phase 03: mutation wrappers ─────────────────────────────────
 * postConfig + postUpdateApply mirror the existing postInit / postCommand
 * shape — validate body via the matching schema, POST, parse the response
 * through its schema (or surface readable error message on non-2xx).
 */

export async function postConfig(body: ConfigUpdateBody): Promise<ConfigUpdateResponse> {
  const validated = ConfigUpdateBodySchema.parse(body);
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return ConfigUpdateResponseSchema.parse(raw);
}

export async function postUpdateApply(): Promise<UpdateApplyResponse> {
  const res = await fetch('/api/update/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return UpdateApplyResponseSchema.parse(raw);
}

export async function fetchArtifactRendered(
  phase: string,
  name: string,
): Promise<RenderedArtifact> {
  const path = `.swt-planning/phases/${phase}/${name}`;
  const url = `/api/artifact?path=${encodeURIComponent(path)}&render=html`;
  const raw = await jsonRequest<unknown>(url);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as { html?: unknown }).html !== 'string'
  ) {
    throw new ApiError('artifact response missing html field', 500);
  }
  const r = raw as { html: string; frontmatter?: Record<string, unknown> };
  return { html: r.html, frontmatter: r.frontmatter ?? {} };
}

/**
 * Plan 04-03 T4 — Pane 5 History tab. Lists the most recent commits that
 * touched an artifact under `.swt-planning/`. Bound to plan 04-02's
 * `GET /api/artifact-history` route.
 */
export interface ArtifactHistoryCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export async function fetchArtifactHistory(
  phase: string,
  name: string,
  limit = 10,
): Promise<ArtifactHistoryCommit[]> {
  const path = `.swt-planning/phases/${phase}/${name}`;
  const url = `/api/artifact-history?path=${encodeURIComponent(path)}&limit=${limit}`;
  const raw = await jsonRequest<unknown>(url);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { commits?: unknown }).commits)
  ) {
    throw new ApiError('artifact-history response missing commits array', 500);
  }
  // Trust the server-side shape; we don't have a zod schema here yet (the
  // shape is locked in plan 04-02's route test).
  return (raw as { commits: ArtifactHistoryCommit[] }).commits;
}

/**
 * Plan 04-03 T4 — Pane 5 diff sub-pane. Unified diff between `base` (a
 * commit SHA) and the working-tree copy of the artifact. Bound to plan
 * 04-02's `GET /api/artifact-diff` route.
 */
export async function fetchArtifactDiff(
  phase: string,
  name: string,
  base: string,
): Promise<string> {
  const path = `.swt-planning/phases/${phase}/${name}`;
  const url = `/api/artifact-diff?path=${encodeURIComponent(path)}&base=${encodeURIComponent(base)}`;
  const raw = await jsonRequest<unknown>(url);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as { diff?: unknown }).diff !== 'string'
  ) {
    throw new ApiError('artifact-diff response missing diff field', 500);
  }
  return (raw as { diff: string }).diff;
}

export async function postUatCheckpoint(
  phase: string,
  body: UatCheckpointBody,
): Promise<UatCheckpointResponse> {
  const validated = UatCheckpointBodySchema.parse(body);
  const res = await fetch(`/api/uat/${encodeURIComponent(phase)}/checkpoint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const raw: unknown = await res.json();
  return UatCheckpointResponseSchema.parse(raw);
}

/**
 * Try to parse a fetch error body as JSON and extract a human-readable message.
 * Falls back to raw text when the body isn't JSON, and to a status-only string
 * when the body is empty. Used by postInit + postCommand to surface clean
 * errors like "init_failed: permission denied" instead of raw HTTP envelopes.
 */
async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; detail?: unknown };
    const error = typeof parsed.error === 'string' ? parsed.error : null;
    const detail = typeof parsed.detail === 'string' ? parsed.detail : null;
    if (error && detail) return `${error}: ${detail}`;
    if (error) return error;
    if (detail) return detail;
  } catch {
    /* not JSON */
  }
  return text;
}

export async function postInit(body: InitBody): Promise<InitResponse> {
  const validated = InitBodySchema.parse(body);
  const res = await fetch('/api/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return InitResponseSchema.parse(raw);
}

export async function postCommand(body: CommandBody): Promise<CommandResponse> {
  const validated = CommandBodySchema.parse(body);
  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status}: ${detail}`, res.status);
  }
  const raw: unknown = await res.json();
  return CommandResponseSchema.parse(raw);
}

export async function postVibeStart(body: VibeStartBody): Promise<VibeStartResponse> {
  const validated = VibeStartBodySchema.parse(body);
  const res = await fetch('/api/vibe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return VibeStartResponseSchema.parse(raw);
}

export async function postVibeReply(
  session_id: string,
  body: VibeReplyBody,
): Promise<VibeReplyResponse> {
  const validated = VibeReplyBodySchema.parse(body);
  const res = await fetch(`/api/vibe/${encodeURIComponent(session_id)}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return VibeReplyResponseSchema.parse(raw);
}
