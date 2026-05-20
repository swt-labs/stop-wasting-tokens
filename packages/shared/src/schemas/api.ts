import { z } from 'zod';

import { SnapshotEventSchema } from './events.js';
import { SnapshotSchema } from './snapshot.js';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime_ms: z.number().int().nonnegative(),
  schema_version: z.literal('1'),
  /**
   * SWT version the daemon is running. Sourced from the CLI's CURRENT_VERSION
   * via the `SWT_DASHBOARD_DAEMON_VERSION` env var the CLI sets when spawning
   * the daemon. Optional for back-compat with v1.6.0–v1.6.7 daemons that
   * don't emit it; v1.7.0+ always does.
   */
  daemon_version: z.string().min(1).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const DebugEmitBodySchema = SnapshotEventSchema;
export type DebugEmitBody = z.infer<typeof DebugEmitBodySchema>;

export const DebugEmitResponseSchema = z.object({
  queued: z.literal(true),
});
export type DebugEmitResponse = z.infer<typeof DebugEmitResponseSchema>;

export const UatCheckpointBodySchema = z.object({
  scenario: z.string().min(1),
  result: z.enum(['pass', 'fail']),
  note: z.string().optional(),
});
export type UatCheckpointBody = z.infer<typeof UatCheckpointBodySchema>;

export const UatCheckpointResponseSchema = z.object({
  saved: z.literal(true),
  path: z.string().min(1),
});
export type UatCheckpointResponse = z.infer<typeof UatCheckpointResponseSchema>;

/**
 * `POST /api/init` body.
 *
 * Milestone 23 Phase 01 T03 — the wizard collects `planning_tracking` +
 * `auto_push` in Step 2; both pass through into `initProject()` via this
 * schema. `.strict()` rejects any unknown field (AC 29), including the
 * deliberately-omitted `provider_id` (Locked Decision #10 — init is
 * vendor-agnostic, AC 30).
 */
export const InitBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    planning_tracking: z.enum(['manual', 'ignore', 'commit']).default('manual'),
    auto_push: z.enum(['never', 'after_phase', 'always']).default('never'),
  })
  .strict();
/**
 * `InitBody` uses the Zod INPUT type (`z.input<>`), NOT the inferred output
 * type. The `.default('manual')` / `.default('never')` clauses make the new
 * fields OPTIONAL at the wire boundary (callers can omit them and Zod fills
 * the defaults on parse) but REQUIRED at the output type. Client code that
 * pre-dates milestone-23's wizard (e.g., the pre-Phase-02 `InitScreen.tsx`)
 * still passes `{ name, description? }` and must continue to compile —
 * the input type accepts that exact shape. The server parses with
 * `InitBodySchema.safeParse(raw)` and reads the (now-populated) output type.
 */
export type InitBody = z.input<typeof InitBodySchema>;

/**
 * `POST /api/init` response.
 *
 * Milestone 23 Phase 01 T03 — extended with `brownfield`, `git_initialized`,
 * and `stack` so the wizard's Step 3 can render the right completion screen
 * without a follow-up GET. Naming follows the snake_case convention used
 * throughout this schema (uptime_ms, session_id, exit_code, etc.); the
 * route handler remaps from `InitProjectResult`'s camelCase fields.
 */
export const InitResponseSchema = z.object({
  initialized: z.literal(true),
  root: z.string().min(1),
  files: z.array(z.string().min(1)),
  /** Whether the cwd was detected as a brownfield project (had user source files). */
  brownfield: z.boolean(),
  /** `true` only when THIS call ran `git init` (not when .git already existed). */
  git_initialized: z.boolean(),
  /** Detected stack tags from detect-stack.sh; empty `[]` for greenfield. */
  stack: z.array(z.string()),
  /**
   * The snapshot the daemon's just-spun-up snapshotter produced. Lets the
   * client drop the redundant follow-up `GET /api/snapshot` round-trip.
   * Optional for back-compat with v1.6.0–v1.6.7 daemons that don't emit it.
   */
  snapshot: SnapshotSchema.optional(),
});
export type InitResponse = z.infer<typeof InitResponseSchema>;

/**
 * `GET /api/init-precheck` response.
 *
 * Milestone 23 Phase 01 T03 — read-only auto-detection for the wizard's
 * Step 1 render. Two discriminated shapes:
 *   - `{ already_initialized: true }` when `.swt-planning/PROJECT.md`
 *     already exists. Other fields are omitted so the wizard short-circuits
 *     into the "already initialized" branch.
 *   - `{ already_initialized: false, brownfield, source_file_count, git }`
 *     for the greenfield + brownfield branches; the wizard renders
 *     "{N source files detected — looks like a brownfield project}" or
 *     similar in Step 1 based on `brownfield` + `source_file_count`, and
 *     surfaces the `git: 'absent'|'repo'|'parent_repo'` hint accordingly.
 */
export const InitPrecheckResponseSchema = z.union([
  z.object({
    already_initialized: z.literal(true),
  }),
  z.object({
    already_initialized: z.literal(false),
    brownfield: z.boolean(),
    source_file_count: z.number().int().nonnegative(),
    git: z.enum(['absent', 'repo', 'parent_repo']),
  }),
]);
export type InitPrecheckResponse = z.infer<typeof InitPrecheckResponseSchema>;

/**
 * `POST /api/map` response.
 *
 * Milestone 23 Phase 03 — the route shells out to `swt map` CLI which
 * fans out to 4 parallel Scout agents internally (the route itself does
 * NOT spawn Scouts directly per Scout Drift 1). Shape mirrors
 * `/api/cook/start`: `session_id` mints the SWT_SESSION_ID env var, `pid`
 * carries the spawned subprocess pid, `started_at` is the ISO timestamp
 * the daemon recorded at spawn. Completion is signalled out-of-band via
 * `state.changed` SSE events once the snapshotter sees the new
 * `.swt-planning/codebase/` directory and flips `snapshot.codebase_mapped`
 * to `true` (PA-4/PA-5 — no new SSE event variants this phase).
 */
export const MapStartResponseSchema = z.object({
  session_id: z.string().min(1),
  pid: z.number().int().nullable(),
  started_at: z.string().datetime({ offset: true }),
});
export type MapStartResponse = z.infer<typeof MapStartResponseSchema>;

export const CommandBodySchema = z.object({
  input: z.string().min(1).max(500),
});
export type CommandBody = z.infer<typeof CommandBodySchema>;

/**
 * How the dashboard's command-bar router decided to handle the input.
 *
 * - `literal` — first token matched the non-interactive allowlist; the
 *   server spawned `swt <argv>` and the response carries the spawn result.
 * - `rejected_interactive` — first token is a known interactive verb
 *   (vibe / watch / dashboard); the server returned a structured rejection
 *   without spawning, because the route closes stdin and would block.
 * - `rejected_unknown` — first token is neither in the allowlist nor in
 *   the interactive list (typos, natural language, stub verbs); rejected
 *   with a hint pointing at the allowlist.
 *
 * Default `'literal'` preserves back-compat with v1.6.0–v1.6.5 clients
 * that don't know about routing decisions.
 */
export const RoutingDecisionSchema = z.enum([
  'literal',
  'rejected_interactive',
  'rejected_unknown',
]);
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const VibeStartBodySchema = z.object({
  prompt: z.string().min(1).max(8000),
  project_context: z.record(z.unknown()).optional(),
  prompt_timeouts: z
    .object({
      clarification_ms: z.number().int().positive().optional(),
      permission_ms: z.number().int().positive().optional(),
    })
    .optional(),
});
export type VibeStartBody = z.infer<typeof VibeStartBodySchema>;

export const VibeStartResponseSchema = z.object({
  session_id: z.string().min(1),
  state: z.enum(['idle', 'running', 'awaiting-reply', 'completed', 'failed', 'expired']),
  /**
   * Whether the daemon has an agent backend configured. When `'none'`, the
   * session was created but no agent will run — the caller saw idle-state
   * and should surface a setup hint to the user. v3 ships Pi as the sole
   * backend; `'pi'` indicates the runtime is wired. Optional for back-
   * compat with pre-v3 daemons that emitted `codex`/`scripted` (those
   * snapshot files must be migrated via `swt migrate --to=v3`).
   */
  agent_backend: z.enum(['none', 'pi']).optional(),
});
export type VibeStartResponse = z.infer<typeof VibeStartResponseSchema>;

export const VibeReplyBodySchema = z.object({
  prompt_id: z.string().min(1),
  answer: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('choice'), value: z.string().min(1) }),
    z.object({ kind: z.literal('free_form'), text: z.string().min(1) }),
    z.object({
      kind: z.literal('permission'),
      decision: z.enum(['once', 'session', 'deny']),
      user_note: z.string().optional(),
    }),
  ]),
});
export type VibeReplyBody = z.infer<typeof VibeReplyBodySchema>;

export const VibeReplyResponseSchema = z.object({
  ok: z.literal(true),
  accepted: z.literal(true),
});
export type VibeReplyResponse = z.infer<typeof VibeReplyResponseSchema>;

export const VibeReplyErrorSchema = z.object({
  ok: z.literal(false),
  error: z.enum([
    'session_not_found',
    'session_not_blocking',
    'prompt_id_mismatch',
    'prompt_expired',
    'invalid_answer_kind',
    'invalid_body',
  ]),
  expected_prompt_id: z.string().optional(),
});
export type VibeReplyError = z.infer<typeof VibeReplyErrorSchema>;

export const CommandResponseSchema = z.object({
  ok: z.boolean(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number().int().nonnegative(),
  /** Routing decision for the input. Defaults to 'literal' for back-compat. */
  routing_decision: RoutingDecisionSchema.default('literal'),
  /** First whitespace token of the input, lowercased. Null when input was empty. */
  verb: z.string().nullable().default(null),
});
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

/* ── v2.3: dashboard CLI parity panels ──────────────────────────────────
 *
 * Five new GET endpoints surface the CLI's `config show`, `doctor`,
 * `detect-phase`, `update --json`, and `help` registry data inside the
 * dashboard. Schemas live here so server and client share one wire
 * contract; concrete inner shapes (e.g. `SwtConfig`, `PhaseDetectResult`)
 * stay typed in their owning packages (`@swt-labs/core`,
 * `@swt-labs/methodology`) and ride through these envelopes as
 * `z.unknown()` to keep `dashboard-core` decoupled from those packages.
 *
 * Phase 1 of v2.3 ships the routes only — read-only, pull-on-demand, no
 * SSE event types. Phase 3 adds writable counterparts (`POST /api/config`,
 * `POST /api/update/apply`).
 */

export const ConfigSnapshotSchema = z.object({
  /**
   * False when the daemon found no `.swt-planning/config.json`. The
   * embedded `config` falls back to `DEFAULT_CONFIG` from `@swt-labs/core`
   * so the dashboard can still render fields against the schema.
   */
  is_initialized: z.boolean(),
  /**
   * Concrete shape is `SwtConfig` from `@swt-labs/core`. Kept as
   * `z.unknown()` here to avoid cross-package coupling — clients import
   * `SwtConfig` directly from `@swt-labs/core` and assert on this field.
   */
  config: z.unknown(),
  source: z.enum(['file', 'default']),
  generated_at: z.string().datetime({ offset: true }),
});
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

export const DoctorCheckSchema = z.object({
  /** Stable id for client-side keying; e.g. 'node-version'. */
  id: z.string().min(1),
  /** Human-readable check name; e.g. 'Node ≥ 20'. */
  name: z.string().min(1),
  status: z.enum(['pass', 'fail', 'warn']),
  /** One-line freeform detail; the panel surfaces this verbatim. */
  detail: z.string(),
});
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export const DoctorReportSchema = z.object({
  checks: z.array(DoctorCheckSchema),
  /** `pass` only when every check passes; `fail` if any fails; else `warn`. */
  overall_status: z.enum(['pass', 'fail', 'warn']),
  generated_at: z.string().datetime({ offset: true }),
});
export type DoctorReport = z.infer<typeof DoctorReportSchema>;

export const DetectPhaseReportSchema = z.object({
  /**
   * Concrete shape is `PhaseDetectResult` from `@swt-labs/methodology`.
   * Kept as `z.unknown()` here for the same decoupling reason as
   * `ConfigSnapshot.config`.
   */
  result: z.unknown(),
  is_initialized: z.boolean(),
  generated_at: z.string().datetime({ offset: true }),
});
export type DetectPhaseReport = z.infer<typeof DetectPhaseReportSchema>;

export const UpdateReportSchema = z.object({
  current_version: z.string().min(1),
  /** Null when the registry was unreachable. Always-present when reachable. */
  latest_version: z.string().nullable(),
  update_available: z.boolean(),
  /** v2.3 ships npm only. Marketplace dispatch lands in a future milestone. */
  registry: z.literal('npm'),
  last_checked: z.string().datetime({ offset: true }),
  /** Null on success; non-null when `latest_version: null` to explain why. */
  error: z.string().nullable(),
});
export type UpdateReport = z.infer<typeof UpdateReportSchema>;

export const CommandSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** Argv usage suffix from the CLI registry; null when verb takes none. */
  usage: z.string().nullable(),
  /**
   * - `core` — verb has a real CLI handler (config / doctor / detect-phase / etc).
   * - `stub` — verb is a roadmap placeholder (init / plan / execute / etc).
   * - `interactive` — verb requires a TTY (vibe / watch / dashboard).
   */
  category: z.enum(['core', 'stub', 'interactive']),
  /**
   * True when the verb can run from the dashboard's `POST /api/command`
   * route without blocking on stdin or recursing the daemon. Mirrors the
   * server-side `ALLOWED_NON_INTERACTIVE_VERBS` set.
   */
  dashboard_safe: z.boolean(),
});
export type CommandSpec = z.infer<typeof CommandSpecSchema>;

export const CommandRegistrySchema = z.object({
  verbs: z.array(CommandSpecSchema),
  generated_at: z.string().datetime({ offset: true }),
});
export type CommandRegistry = z.infer<typeof CommandRegistrySchema>;

/* ── v2.3 Phase 03: mutation routes ─────────────────────────────────── */

/**
 * `POST /api/config` body. The inner `config` carries the new SwtConfig
 * shape; kept as `z.unknown()` here so dashboard-core stays decoupled
 * from `@swt-labs/core`. The server validates via `parseConfig` after
 * this layer's structural check.
 */
export const ConfigUpdateBodySchema = z
  .object({
    config: z.unknown(),
  })
  .strict();
export type ConfigUpdateBody = z.infer<typeof ConfigUpdateBodySchema>;

export const ConfigUpdateResponseSchema = z.object({
  ok: z.literal(true),
  config: z.unknown(),
  generated_at: z.string().datetime({ offset: true }),
});
export type ConfigUpdateResponse = z.infer<typeof ConfigUpdateResponseSchema>;

/**
 * `POST /api/update/apply` response. Daemon attempts `npm i -g
 * stop-wasting-tokens@latest`; on EACCES/EPERM the response carries
 * `requires_elevation: true` + a `copyable_command` the panel can
 * surface for the user to run via sudo.
 */
export const UpdateApplyResponseSchema = z.object({
  ok: z.boolean(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number().int().nonnegative(),
  requires_elevation: z.boolean(),
  /** Null when `requires_elevation` is false. */
  copyable_command: z.string().nullable(),
});
export type UpdateApplyResponse = z.infer<typeof UpdateApplyResponseSchema>;

/* ── Phase 3: provider-auth (vendor-select panel) routes ─────────────── */

/**
 * The provider ids the dashboard's vendor dropdown offers. Aligned with
 * `@earendil-works/pi-ai`'s `KnownProvider` union (research §1) — every id
 * below is a member of that union (verified against
 * `node_modules/.pnpm/@earendil-works+pi-ai@0.74.0.../dist/types.d.ts`).
 * `provider-router` (`packages/orchestration/src/provider-router.ts`) keeps
 * provider ids as free-form strings (no fixed list), so it imposes no
 * additional constraint — the pi-ai union is the binding vocabulary.
 *
 * The client SPA mirrors THIS list (it depends on @swt-labs/shared already),
 * so the dashboard needs no @swt-labs/runtime dependency for the dropdown
 * (Risk 6). `anthropic` + `openai` are the milestone's primary targets.
 */
export const PROVIDER_VOCABULARY = [
  'anthropic',
  'openai',
  'google',
  'openai-codex',
  'deepseek',
  'github-copilot',
  'xai',
  'groq',
  'openrouter',
  'mistral',
] as const;
export type ProviderId = (typeof PROVIDER_VOCABULARY)[number];

/**
 * Wire form of Phase 1/2's `AuthMode`. The route bridges this to the
 * `AuthMode` the CredentialStore expects.
 */
export const ProviderAuthModeSchema = z.enum(['api_key', 'oauth']);
export type ProviderAuthMode = z.infer<typeof ProviderAuthModeSchema>;

/**
 * Secret-FREE per-provider auth status. Mirrors Pi's
 * `AuthStorage.getAuthStatus` ({configured, source, label}) + the provider
 * id and selected mode. NO secret/key/apiKey/token field — the panel shows
 * "configured", never the value.
 */
export const ProviderAuthStatusSchema = z.object({
  provider: z.string().min(1),
  configured: z.boolean(),
  mode: z.union([ProviderAuthModeSchema, z.null()]),
  /**
   * Where the credential resolves from: the OS keychain, or an env var
   * (headless fallback), or null when not configured.
   */
  source: z.union([z.enum(['keychain', 'env']), z.null()]),
  /** Short human label, e.g. "Keychain", "ANTHROPIC_API_KEY". Never the value. */
  label: z.union([z.string(), z.null()]),
});
export type ProviderAuthStatus = z.infer<typeof ProviderAuthStatusSchema>;

/**
 * `GET /api/provider-auth` response. The current selection + per-provider
 * status + keychain availability for the panel's banner. No secrets.
 */
export const ProviderAuthSnapshotSchema = z.object({
  /** The provider `providers.strategy` currently pins, or null. */
  selected_provider: z.union([z.string(), z.null()]),
  /**
   * The `providers.strategy.kind` ('pinned' | 'round-robin' | …). The panel
   * warns when it is not 'pinned' (the dropdown only drives the pinned case).
   */
  strategy_kind: z.string(),
  /**
   * False on headless hosts — the panel renders the "keychain unavailable"
   * banner with env-var guidance (research §3, Phase 1 probe result).
   */
  keychain_available: z.boolean(),
  keychain_reason: z.union([z.string(), z.null()]),
  statuses: z.array(ProviderAuthStatusSchema),
  generated_at: z.string().datetime({ offset: true }),
});
export type ProviderAuthSnapshot = z.infer<typeof ProviderAuthSnapshotSchema>;

/**
 * `POST /api/provider-auth` body. `apiKey` is the ONLY secret-carrying
 * field in the whole provider-auth contract and it is INBOUND ONLY — the
 * secret travels client→server exactly once and goes straight to the
 * keychain. `apiKey` is OPTIONAL: an `authMode:'oauth'` save carries no
 * key (Phase 4), and re-selecting an already-configured `api_key` provider
 * may omit it to keep the existing keychain entry.
 */
export const ProviderAuthUpdateBodySchema = z
  .object({
    provider: z.string().min(1),
    authMode: ProviderAuthModeSchema,
    apiKey: z.string().min(1).optional(),
  })
  .strict();
export type ProviderAuthUpdateBody = z.infer<typeof ProviderAuthUpdateBodySchema>;

/**
 * `POST /api/provider-auth` response — the fresh snapshot after the write.
 * No secret echoed back (the embedded snapshot is secret-free).
 */
export const ProviderAuthUpdateResponseSchema = z.object({
  ok: z.literal(true),
  snapshot: ProviderAuthSnapshotSchema,
  generated_at: z.string().datetime({ offset: true }),
});
export type ProviderAuthUpdateResponse = z.infer<typeof ProviderAuthUpdateResponseSchema>;

/* ── GET /api/models ─ Pi ModelRegistry → dashboard ────────────────────
 * Lists every model Pi knows about (built-in + per-provider config), so
 * the TopBar Model dropdown can render an authoritative per-provider
 * list without the dashboard mirroring Pi's registry locally. Per-entry
 * payload is intentionally minimal — id (the canonical key the dashboard
 * persists into `config.model`), provider, contextWindow, reasoning,
 * name (for display when richer than the id alone).
 */

export const ModelInfoSchema = z.object({
  /** Canonical model id (matches what gets written to `config.model`). */
  id: z.string().min(1),
  /** Owning provider id ('anthropic', 'openai', etc. — matches PROVIDER_VOCABULARY). */
  provider: z.string().min(1),
  /** Optional human display name. Falls back to `id` when absent. */
  name: z.union([z.string().min(1), z.null()]).default(null),
  /** Pi `contextWindow` token budget (0 when unknown). */
  contextWindow: z.number().int().nonnegative().default(0),
  /** True for reasoning/extended-thinking models (Claude opus thinking, o1, etc.). */
  reasoning: z.boolean().default(false),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ModelsSnapshotSchema = z.object({
  /** Flat list across every provider; dashboard groups by provider client-side. */
  models: z.array(ModelInfoSchema),
  generated_at: z.string().datetime({ offset: true }),
});
export type ModelsSnapshot = z.infer<typeof ModelsSnapshotSchema>;

/* ── Phase 4: provider-auth OAuth login routes ───────────────────────── */

/**
 * `POST /api/provider-auth/oauth/start` body. Just the provider id — OAuth
 * carries NO inbound secret (the credential is produced server-side by
 * pi-ai's login() flow and goes straight to the keychain). `.strict()`
 * rejects any attempt to smuggle a secret field in.
 */
export const OAuthStartBodySchema = z
  .object({
    provider: z.string().min(1),
  })
  .strict();
export type OAuthStartBody = z.infer<typeof OAuthStartBodySchema>;

/**
 * `POST /api/provider-auth/oauth/code` body — the Risk-4 headless manual-code
 * paste flow. `flow_id` correlates to the in-flight OAuth flow (from the
 * oauth.* SSE events / the /oauth/start response); `code` is the
 * authorization code the user copied from the provider's browser page.
 */
export const OAuthManualCodeBodySchema = z
  .object({
    flow_id: z.string().min(1),
    code: z.string().min(1),
  })
  .strict();
export type OAuthManualCodeBody = z.infer<typeof OAuthManualCodeBodySchema>;

/**
 * `POST /api/provider-auth/oauth/start` response. The flow has begun — here
 * is its `flow_id` to correlate the SSE `oauth.*` events that will follow.
 * NO token, NO snapshot: completion arrives via the `oauth.complete` SSE
 * event, and the credential lives only in the keychain.
 */
export const OAuthStartResponseSchema = z
  .object({
    ok: z.literal(true),
    flow_id: z.string().min(1),
    provider: z.string().min(1),
    started_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;

/**
 * `POST /api/provider-auth/oauth/code` acknowledgement — the pasted code was
 * accepted into the flow. The actual login completion still arrives via the
 * `oauth.complete` (or `oauth.error`) SSE event.
 */
export const OAuthManualCodeResponseSchema = z
  .object({
    ok: z.literal(true),
    flow_id: z.string().min(1),
  })
  .strict();
export type OAuthManualCodeResponse = z.infer<typeof OAuthManualCodeResponseSchema>;

/**
 * `POST /api/provider-auth/oauth/token` body — codex-Oauth.md #5: enterprise
 * access-token pipe-in. ChatGPT Business and Enterprise admins create
 * long-lived Codex access tokens in the admin console (per
 * https://developers.openai.com/codex/enterprise/access-tokens). These tokens
 * bypass the browser-based OAuth flow entirely — the user provides them once
 * and SWT stores them in the keychain under the same `oauth` namespace the
 * browser flow uses.
 *
 * The `expires_at` field accepts an ISO-8601 timestamp; when omitted, the
 * credential is stored as effectively-never-expires (pi-ai's
 * `getOAuthApiKey` won't trigger its refresh logic).
 *
 * `.strict()` rejects unknown fields. The route's `X-SWT-Credential-Write`
 * header gate (mirroring `POST /api/provider-auth`) protects against
 * cross-site write attempts.
 */
export const OAuthEnterpriseTokenBodySchema = z
  .object({
    provider: z.string().min(1),
    access_token: z.string().min(1),
    expires_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type OAuthEnterpriseTokenBody = z.infer<typeof OAuthEnterpriseTokenBodySchema>;

/**
 * `POST /api/provider-auth/oauth/token` response — codex-Oauth.md #5.
 * The credential has been written to the keychain; the dashboard panel
 * refetches `providerAuth` on the accompanying `state.changed` SSE event.
 */
export const OAuthEnterpriseTokenResponseSchema = z
  .object({
    ok: z.literal(true),
    provider: z.string().min(1),
  })
  .strict();
export type OAuthEnterpriseTokenResponse = z.infer<typeof OAuthEnterpriseTokenResponseSchema>;

/* ── User Notes — freeform per-project scratchpad ────────────────────────
 *
 * A deliberately-isolated personal scratchpad backed by a single plain-text
 * file (`<cwd>/.swt-planning/USER_NOTES.md`). Decoupled from the methodology
 * artifacts by design: no SSE coupling, not on the dashboard poll loop —
 * the dashboard fetches it once on bootstrap and auto-saves on a debounce.
 *
 * The schemas mirror the `Config*` idiom: a GET snapshot, a `.strict()` POST
 * body, and a minimal POST response. The notes string is capped at 1 MB so a
 * runaway client cannot write an unbounded file.
 */

export const UserNotesSnapshotSchema = z.object({
  /** The notes file content. Empty string on greenfield (file absent). */
  notes: z.string(),
  /** False when `<cwd>/.swt-planning/USER_NOTES.md` does not exist yet. */
  exists: z.boolean(),
  generated_at: z.string().datetime({ offset: true }),
});
export type UserNotesSnapshot = z.infer<typeof UserNotesSnapshotSchema>;

/**
 * `POST /api/user-notes` body. `notes` is capped at 1 MB — the panel is a
 * personal scratchpad, not a document store; the cap stops a runaway client
 * from writing an unbounded file. `.strict()` rejects any extra fields.
 */
export const UserNotesUpdateBodySchema = z
  .object({
    notes: z.string().max(1_000_000),
  })
  .strict();
export type UserNotesUpdateBody = z.infer<typeof UserNotesUpdateBodySchema>;

export const UserNotesUpdateResponseSchema = z.object({
  ok: z.literal(true),
  generated_at: z.string().datetime({ offset: true }),
});
export type UserNotesUpdateResponse = z.infer<typeof UserNotesUpdateResponseSchema>;

export const ApiSchemas = {
  '/api/health': {
    method: 'GET',
    response: HealthResponseSchema,
  },
  '/api/_debug/emit': {
    method: 'POST',
    body: DebugEmitBodySchema,
    response: DebugEmitResponseSchema,
  },
  '/api/events': {
    method: 'GET',
    sse: SnapshotEventSchema,
  },
  '/api/uat/:phase/checkpoint': {
    method: 'POST',
    body: UatCheckpointBodySchema,
    response: UatCheckpointResponseSchema,
  },
  '/api/init': {
    method: 'POST',
    body: InitBodySchema,
    response: InitResponseSchema,
  },
  '/api/init-precheck': {
    method: 'GET',
    response: InitPrecheckResponseSchema,
  },
  '/api/map': {
    method: 'POST',
    response: MapStartResponseSchema,
  },
  '/api/command': {
    method: 'POST',
    body: CommandBodySchema,
    response: CommandResponseSchema,
  },
  '/api/vibe': {
    method: 'POST',
    body: VibeStartBodySchema,
    response: VibeStartResponseSchema,
  },
  '/api/vibe/:session_id/reply': {
    method: 'POST',
    body: VibeReplyBodySchema,
    response: VibeReplyResponseSchema,
  },
  '/api/config': {
    method: 'GET',
    response: ConfigSnapshotSchema,
  },
  '/api/doctor': {
    method: 'GET',
    response: DoctorReportSchema,
  },
  '/api/detect-phase': {
    method: 'GET',
    response: DetectPhaseReportSchema,
  },
  '/api/update': {
    method: 'GET',
    response: UpdateReportSchema,
  },
  '/api/commands': {
    method: 'GET',
    response: CommandRegistrySchema,
  },
  '/api/config:POST': {
    method: 'POST',
    body: ConfigUpdateBodySchema,
    response: ConfigUpdateResponseSchema,
  },
  '/api/update/apply': {
    method: 'POST',
    response: UpdateApplyResponseSchema,
  },
  '/api/user-notes': {
    method: 'GET',
    response: UserNotesSnapshotSchema,
  },
  '/api/user-notes:POST': {
    method: 'POST',
    body: UserNotesUpdateBodySchema,
    response: UserNotesUpdateResponseSchema,
  },
} as const;
export type ApiSchemaMap = typeof ApiSchemas;
