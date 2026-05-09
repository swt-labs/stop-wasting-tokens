import {
  CommandBodySchema,
  CommandResponseSchema,
  HealthResponseSchema,
  InitBodySchema,
  InitResponseSchema,
  SnapshotSchema,
  UatCheckpointBodySchema,
  UatCheckpointResponseSchema,
  type CommandBody,
  type CommandResponse,
  type HealthResponse,
  type InitBody,
  type InitResponse,
  type Snapshot,
  type UatCheckpointBody,
  type UatCheckpointResponse,
} from '@swt-labs/dashboard-core';

export type {
  CommandBody,
  CommandResponse,
  InitBody,
  InitResponse,
  UatCheckpointBody,
  UatCheckpointResponse,
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

export async function postInit(body: InitBody): Promise<InitResponse> {
  const validated = InitBodySchema.parse(body);
  const res = await fetch('/api/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status}: ${detail}`, res.status);
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
