import {
  CommandBodySchema,
  CommandResponseSchema,
  ConfigSnapshotSchema,
  DetectPhaseReportSchema,
  DoctorReportSchema,
  HealthResponseSchema,
  InitBodySchema,
  InitResponseSchema,
  SnapshotSchema,
  UatCheckpointBodySchema,
  UatCheckpointResponseSchema,
  UpdateReportSchema,
  VibeReplyBodySchema,
  VibeReplyResponseSchema,
  VibeStartBodySchema,
  VibeStartResponseSchema,
  type CommandBody,
  type CommandResponse,
  type ConfigSnapshot,
  type DetectPhaseReport,
  type DoctorReport,
  type HealthResponse,
  type InitBody,
  type InitResponse,
  type Snapshot,
  type UatCheckpointBody,
  type UatCheckpointResponse,
  type UpdateReport,
  type VibeReplyBody,
  type VibeReplyResponse,
  type VibeStartBody,
  type VibeStartResponse,
} from '@swt-labs/dashboard-core';

export type {
  CommandBody,
  CommandResponse,
  ConfigSnapshot,
  DetectPhaseReport,
  DoctorReport,
  InitBody,
  InitResponse,
  UatCheckpointBody,
  UatCheckpointResponse,
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
 * @swt-labs/dashboard-core so panel components see fully-typed data
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
