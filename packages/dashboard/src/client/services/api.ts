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
  OAuthManualCodeBodySchema,
  OAuthManualCodeResponseSchema,
  OAuthStartBodySchema,
  OAuthStartResponseSchema,
  ProviderAuthSnapshotSchema,
  ProviderAuthUpdateBodySchema,
  ProviderAuthUpdateResponseSchema,
  SnapshotSchema,
  UatCheckpointBodySchema,
  UatCheckpointResponseSchema,
  UpdateApplyResponseSchema,
  UpdateReportSchema,
  UserNotesSnapshotSchema,
  UserNotesUpdateBodySchema,
  UserNotesUpdateResponseSchema,
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
  type OAuthManualCodeResponse,
  type OAuthStartResponse,
  type ProviderAuthSnapshot,
  type ProviderAuthStatus,
  type ProviderAuthUpdateBody,
  type ProviderAuthUpdateResponse,
  type Snapshot,
  type UatCheckpointBody,
  type UatCheckpointResponse,
  type UpdateApplyResponse,
  type UpdateReport,
  type UserNotesSnapshot,
  type UserNotesUpdateBody,
  type UserNotesUpdateResponse,
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
  OAuthManualCodeResponse,
  OAuthStartResponse,
  ProviderAuthSnapshot,
  ProviderAuthStatus,
  ProviderAuthUpdateBody,
  ProviderAuthUpdateResponse,
  UatCheckpointBody,
  UatCheckpointResponse,
  UpdateApplyResponse,
  UpdateReport,
  UserNotesSnapshot,
  UserNotesUpdateBody,
  UserNotesUpdateResponse,
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

/**
 * Phase 3 — `GET /api/provider-auth`. The vendor-select panel's read side:
 * the current selection + per-provider auth *status* + keychain
 * availability for the panel's banner. The response is secret-FREE by
 * 03-01's `ProviderAuthSnapshotSchema` construction — there is no key
 * value on the wire. Mirrors `fetchConfig`: thin GET wrapper, parses the
 * response through the matching `@swt-labs/shared` schema so the panel
 * sees fully-typed data and any wire drift surfaces here.
 */
export async function fetchProviderAuth(): Promise<ProviderAuthSnapshot> {
  const raw = await jsonRequest<unknown>('/api/provider-auth');
  return ProviderAuthSnapshotSchema.parse(raw);
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

/* ── User Notes — freeform per-project scratchpad ─────────────────────
 * `fetchUserNotes` / `postUserNotes` mirror `fetchConfig` / `postConfig`:
 * thin GET/POST wrappers that validate through the matching
 * `@swt-labs/shared` schema so the panel sees fully-typed data and any
 * wire drift surfaces here. The notes file is deliberately isolated —
 * no SSE coupling, not on the poll loop (see dashboard-store.ts).
 */

export async function fetchUserNotes(): Promise<UserNotesSnapshot> {
  const raw = await jsonRequest<unknown>('/api/user-notes');
  return UserNotesSnapshotSchema.parse(raw);
}

export async function postUserNotes(notes: string): Promise<UserNotesUpdateResponse> {
  const validated: UserNotesUpdateBody = UserNotesUpdateBodySchema.parse({ notes });
  const res = await fetch('/api/user-notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return UserNotesUpdateResponseSchema.parse(raw);
}

/**
 * Phase 3 — `POST /api/provider-auth`. Persists the vendor selection +
 * writes the API key to the OS keychain. Mirrors `postConfig`, plus the
 * Risk-7 `X-SWT-Credential-Write: confirm` header the credential-write
 * route requires (a confused-deputy / CSRF defense-in-depth gate layered
 * on top of the per-boot `Bearer` token). This wrapper is the ONLY place
 * the client sets that header — every `postProviderAuth` call carries it
 * unconditionally; the panel + store never set it manually.
 *
 * The `apiKey` field is INBOUND ONLY — it travels client→server exactly
 * once in this body and goes straight to the keychain. The response's
 * embedded snapshot is secret-free.
 */
export async function postProviderAuth(
  body: ProviderAuthUpdateBody,
): Promise<ProviderAuthUpdateResponse> {
  const validated = ProviderAuthUpdateBodySchema.parse(body);
  const res = await fetch('/api/provider-auth', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-SWT-Credential-Write': 'confirm',
    },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return ProviderAuthUpdateResponseSchema.parse(raw);
}

/**
 * Plan 04-03 (Phase 4) — `POST /api/provider-auth/oauth/start`. Kick off an
 * OAuth login flow for `provider`. The flow runs in the background on the
 * server (pi-ai's `OAuthProviderInterface.login()` driven by plan 04-02's
 * route); this returns immediately with the `flow_id` to correlate the
 * `oauth.*` SSE events that follow. Carries the Risk-7
 * `X-SWT-Credential-Write: confirm` header — an OAuth flow culminates in a
 * keychain write, so it is a credential-write operation, gated the same way
 * `postProviderAuth` is. `api.ts` stays the single client-side owner of that
 * header. No secret travels on this request — OAuth carries no inbound key.
 */
export async function postOAuthStart(provider: string): Promise<OAuthStartResponse> {
  const validated = OAuthStartBodySchema.parse({ provider });
  const res = await fetch('/api/provider-auth/oauth/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-SWT-Credential-Write': 'confirm',
    },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return OAuthStartResponseSchema.parse(raw);
}

/**
 * Plan 04-03 (Phase 4) — `POST /api/provider-auth/oauth/code`. Feed a
 * manually-pasted authorization code into an in-flight OAuth flow (the
 * Risk-4 headless paste path). `flow_id` correlates to the running flow
 * (from the `/oauth/start` response or the `oauth.*` SSE events); `code` is
 * the authorization code the user copied from the provider's browser page.
 * The actual login completion still arrives via the `oauth.complete` SSE
 * event — this route just acknowledges the paste. Carries the same
 * `X-SWT-Credential-Write: confirm` header `postOAuthStart` does.
 *
 * `code` is used ONLY in the request body — it is never logged, never
 * stored in a module-level variable, and not retained after this `fetch`.
 */
export async function postOAuthCode(
  flow_id: string,
  code: string,
): Promise<OAuthManualCodeResponse> {
  const validated = OAuthManualCodeBodySchema.parse({ flow_id, code });
  const res = await fetch('/api/provider-auth/oauth/code', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-SWT-Credential-Write': 'confirm',
    },
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  return OAuthManualCodeResponseSchema.parse(raw);
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

/**
 * G-D3 — `POST /api/cook/start`. The v3 successor to the removed v2
 * vibe-start helper that targeted the `/api/vibe` shim (deleted in commit
 * 860b59d). Spawns `swt cook` as a detached subprocess server-side; the daemon mints the
 * session_id. Cook is plan-driven and non-interactive — there is no
 * per-call free-text "prompt" in v3, so the dashboard's TopBar prompt is
 * kept only for the local session log line / `initial_prompt` display and
 * is NOT forwarded on the wire. Optional `args` flow straight through to
 * the `swt cook` CLI invocation.
 *
 * No zod schema in `@swt-labs/shared` for this route's response yet — the
 * server-side shape is locked by `cook-start.ts` + its route test; we do a
 * thin runtime shape check here (mirrors `fetchArtifactHistory`).
 */
export interface CookStartResponse {
  session_id: string;
  pid: number | null;
  started_at: string;
}

export async function postCookStart(args?: ReadonlyArray<string>): Promise<CookStartResponse> {
  const res = await fetch('/api/cook/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args && args.length > 0 ? { args } : {}),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
  const raw: unknown = await res.json();
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as { session_id?: unknown }).session_id !== 'string'
  ) {
    throw new ApiError('cook/start response missing session_id field', 500);
  }
  const r = raw as { session_id: string; pid?: number | null; started_at?: string };
  return {
    session_id: r.session_id,
    pid: typeof r.pid === 'number' ? r.pid : null,
    started_at: typeof r.started_at === 'string' ? r.started_at : new Date().toISOString(),
  };
}

/**
 * G-D3 — `POST /api/prompts/:id/respond`. The v3 successor to the removed
 * v2 vibe-reply helper that targeted the `/api/vibe/:id/reply` shim. This
 * is the dashboard side of the `swt:askUser` IPC contract from Phase 1 (plan 01-05):
 * `agent.prompt` SSE events populate the conversation thread, and the user's
 * answer to a pending entry flows back through this route as a
 * `prompt.response` bus event the orchestrator awaits.
 *
 * The wire body is `{prompt_id, selectedOption, freeform}` — both
 * `selectedOption` and `freeform` are nullable strings (one is set, the
 * other null). Callers map their UI answer shape (choice / free_form /
 * permission) onto that pair before calling.
 */
export interface PromptRespondBody {
  prompt_id: string;
  selectedOption: string | null;
  freeform: string | null;
}

export async function postPromptRespond(body: PromptRespondBody): Promise<void> {
  const res = await fetch(`/api/prompts/${encodeURIComponent(body.prompt_id)}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new ApiError(message, res.status);
  }
}
