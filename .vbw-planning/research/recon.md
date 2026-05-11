# Recon Report — SWT v2 → v3 TDD2 Authoring

> **Purpose:** Ground-truth fact-base assembled from the cloned `swt-labs/stop-wasting-tokens` v2.3.5 repo and the verified Pi SDK docs at `pi.dev/docs/latest`. Feeds TDD2.md. Every claim here is sourced. No invention.

---

## 1. SWT v2.3.5 inventory (cloned repo: `.vbw-planning/research/swt-v2-source/`)

### 1.1 Workspace layout

```
swt-v2-source/
├── package.json                 # root binary `swt`, tsup bundle, Node ≥20.18
├── pnpm-workspace.yaml          # workspaces: ., packages/*, docs
├── tsup.config.ts
├── vitest.config.ts
├── tsconfig.{base,build,eslint,json}.json
├── eslint.config.mjs
├── packages/                    # 11 workspace packages
│   ├── core/                    # type defs, abstractions, errors
│   ├── artifacts/               # PROJECT/REQUIREMENTS/ROADMAP/STATE engine
│   ├── methodology/             # six-agent SDLC
│   ├── cli/                     # `swt` command surface
│   ├── dashboard/               # Hono server + Solid client
│   ├── dashboard-core/          # shared Zod schemas
│   ├── verification/            # goal-backward QA
│   ├── telemetry/               # opt-in metrics
│   ├── codex-driver/            # ⚠ DELETE in v3
│   ├── claude-code-driver/      # ⚠ DELETE in v3
│   └── ollama-driver/           # ⚠ DELETE in v3 (subsumed by Pi providers)
├── .changeset/                  # release automation
├── .codex-plugin/               # ⚠ DELETE in v3 (Codex MCP wiring)
├── .github/workflows/           # ci, codeql, install-smoke, release, vale
├── docs/                        # 17 doc files
├── scripts/                     # bump-version, check-bundle-size, check-offline, docs-gen, verify-install
├── skills/                      # 6 skill directories
├── templates/
└── test/                        # only 2 root-level tests; rest live in packages
```

### 1.2 Per-package inventory

| Package | Name | Top-level src/ contents | v3 verdict |
|---|---|---|---|
| `core` | `@swt-labs/core` | abstractions/ (HookHost, AgentSpawner, PermissionGate, MemoryStore), config/, errors/, handoff/, scaffold/, types/ | **MIGRATE** → split: abstractions→methodology, types/schemas→shared |
| `artifacts` | `@swt-labs/artifacts` | atomic-write.ts, frontmatter.ts, bootstrap/, milestones/, phases/, qa/, roadmap/, schemas/ (Zod), state/ | **MIGRATE INTACT** → `packages/core/artefacts/` (v3 nomenclature) |
| `methodology` | `@swt-labs/methodology` | audit/, discussion/, memory/, profiles/, prompt-builder/, qa/, state/, vibe/ | **MIGRATE INTACT** (this is the "IP") → `packages/core/methodology/` |
| `cli` | `@swt-labs/cli` | argv.ts, commands/, exit-codes.ts, help.ts, lib/, lifecycle/, main.ts, prompters/, router.ts, watch/ | **MIGRATE + CULL** ~22 stubs |
| `dashboard` | `@swt-labs/dashboard` | server/ (Hono), client/ (Solid SPA) | **MIGRATE + EXTEND** (new SSE source: Pi events) |
| `dashboard-core` | `@swt-labs/dashboard-core` | schemas/ (Snapshot, SnapshotEvent, ApiSchemas) | **MIGRATE** → keep as schema-only package or fold into shared |
| `verification` | `@swt-labs/verification` | checks/, circuit-breaker.ts, guards/, runner.ts, traceability.ts | **MIGRATE INTACT** → `packages/core/verification/` |
| `telemetry` | `@swt-labs/telemetry` | anonymous-id.ts, client.ts, events.ts, http-sender.ts, sanitize.ts, sender.ts | **MIGRATE INTACT**, retarget event names |
| `codex-driver` | `@swt-labs/codex-driver` | agents-md/, hooks/, paths.ts, prompts/, skills/, spawn/, spawner/, toml/, version.ts | **DELETE** (entire driver gone) |
| `claude-code-driver` | `@swt-labs/claude-code-driver` | hooks/, spawn/, spawner/ | **DELETE** |
| `ollama-driver` | `@swt-labs/ollama-driver` | sandbox/, spawn/, spawner/ | **DELETE** (Ollama handled via Pi provider config) |

### 1.3 Dependency graph (v2.3.5, internal)

```
cli ──► artifacts, claude-code-driver, codex-driver, methodology, ollama-driver, telemetry, verification, core
dashboard ──► cli, core, dashboard-core, methodology
methodology ──► artifacts, codex-driver, core              ⚠ codex-driver leak into methodology
artifacts ──► core
codex-driver ──► core
claude-code-driver ──► core
ollama-driver ──► core
verification ──► core
telemetry ──► core
dashboard-core ──► (zod only)
```

**Architectural debt observed (two layers):**

1. **`methodology` depends on `codex-driver` directly** — violates Principle 1 (methodology is IP, vendor-agnostic). The migration must break this edge first.

2. **`cli` imports from all three driver packages in source** (not just declared as workspace deps) — violates Principle 3 (provider is a parameter):
   - `packages/cli/src/commands/vibe.ts` imports **three spawner classes**: `CodexAgentSpawner` (from `@swt-labs/codex-driver`), `ClaudeCodeAgentSpawner` (from `@swt-labs/claude-code-driver`), and `OllamaAgentSpawner` (from `@swt-labs/ollama-driver`). The verb dispatches on the `backend:` config field to pick which spawner to instantiate — a single source file imports every driver.
   - `packages/cli/src/commands/doctor.ts` imports `detectCodexVersion` + `CodexVersion` from `@swt-labs/codex-driver`.

The cli edge is "less severe than methodology" only in the principle-violation sense (CLI is Layer 5; it's allowed to know about runtimes). It's "more severe" in practical scope (4 source imports across 2 files spanning 3 driver packages vs methodology's 1 import from 1 driver). Both must be broken before any Pi integration.

### 1.4 CI/CD inventory (`.github/workflows/`)

| Workflow | Purpose (inferred from filename; bodies not yet read) |
|---|---|
| `ci.yml` | PR + main: lint, typecheck, test, build |
| `codeql.yml` | Security scanning |
| `install-smoke.yml` | Cross-package-manager × OS install smoke (npm/pnpm/bun × ubuntu/macos) |
| `release.yml` | Changesets-driven npm publish with provenance |
| `vale.yml` | Documentation style linting (Vale) |

Scripts: `bump-version.sh`, `check-bundle-size.mjs`, `check-offline.mjs`, `docs-gen.ts`, `verify-install.sh`.

### 1.5 Test inventory

Only 2 tests at repo root level (`test/codex-plugin-manifest.test.ts`, `test/docs/drift.test.ts`). Bulk of tests must live in `packages/*/test/` — needs sweep during recon-phase-two (Phase B continued).

### 1.6 Notable v2 patterns (from `CLAUDE.md` in v2 root)

- v2.3.x shipped a four-release series (2.3.0 → 2.3.3) with install-smoke matrix per patch
- Permission gate has a known follow-up: `UiPermissionGate` for direct UI mutations
- Dashboard CLI parity panels (Config / Doctor / Detect-Phase / Update) + cmd-K palette
- Layout-storage v2 (5-column main + tools array) + 60s polling with `document.visibilitychange` pause
- Phase 04 of 2.3 was bug-fix focused: daemon double-spawn (tsup inlined CLI side-effect), README staleness, 24h cache stale-after-upgrade

These are the user-experience invariants TDD2 must preserve.

---

## 2. Verified Pi SDK API surface (source: pi.dev/docs/latest, fetched 2026-05-11)

### 2.1 Package namespace correction

> **TDD.md error:** asserts `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`.
> **Actual:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`.

All v3 imports, dependency declarations, peerDependencies entries MUST use `@earendil-works/*`.

### 2.2 Core SDK functions

```ts
createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>
createAgentSessionRuntime(factory: CreateAgentSessionRuntimeFactory, options: RuntimeOptions): Promise<AgentSessionRuntime>

class InteractiveMode {
  constructor(runtime: AgentSessionRuntime, options: {...})
  run(): Promise<void>
}
function runPrintMode(runtime: AgentSessionRuntime, options: {...}): Promise<void>
function runRpcMode(runtime: AgentSessionRuntime): Promise<void>
```

### 2.3 AgentSession interface (verified)

```ts
interface AgentSession {
  prompt(text: string, options?: PromptOptions): Promise<void>
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void

  sessionFile: string | undefined
  sessionId: string

  setModel(model: Model): Promise<void>
  setThinkingLevel(level: ThinkingLevel): void
  cycleModel(): Promise<ModelCycleResult | undefined>
  cycleThinkingLevel(): ThinkingLevel | undefined

  agent: Agent
  model: Model | undefined
  thinkingLevel: ThinkingLevel
  messages: AgentMessage[]
  isStreaming: boolean

  navigateTree(targetId: string, options?: NavigateOptions): Promise<{editorText?: string; cancelled: boolean}>
  compact(customInstructions?: string): Promise<CompactionResult>
  abortCompaction(): void
  abort(): Promise<void>
  dispose(): void
}
```

### 2.4 Event types (14 events documented)

`message_update`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `message_start`, `message_end`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end`.

AssistantMessageEvent deltas: `text_start/delta/end`, `thinking_start/delta/end`, `toolcall_start/delta/end`, `done`, `error`.

### 2.5 Tool factories (built-in)

```ts
createCodingTools(cwd: string): AgentTool[]
createReadOnlyTools(cwd: string): AgentTool[]
createReadTool / createBashTool / createEditTool / createWriteTool / createGrepTool / createFindTool / createLsTool(cwd: string): AgentTool
```

For custom tools, use `defineTool` (SDK) or `pi.registerTool` (Extension API).

### 2.6 Custom tool shape

```ts
pi.registerTool({
  name, label, description,
  promptSnippet?, promptGuidelines?,
  parameters: TSchema,                 // typebox
  prepareArguments?(args): args,
  execute(toolCallId, params, signal, onUpdate, ctx): Promise<ToolResult>,
  renderCall?, renderResult?, renderShell?: "self",
})
```

Tool can return `{ terminate: true }` to hint skipping the follow-up LLM call.

### 2.7 Extension API (key surface)

- `pi.on(event, handler)` — 17+ hook events including `session_start`, `before_agent_start`, `agent_end`, `tool_call`, `tool_result`, `context`, `before_provider_request`, `after_provider_response`
- `pi.registerTool` / `pi.registerProvider` / `pi.registerCommand` / `pi.registerShortcut` / `pi.registerFlag` / `pi.registerMessageRenderer`
- `pi.sendMessage(message, {deliverAs: "steer" | "followUp" | "nextTurn"})`
- `pi.setModel`, `pi.setThinkingLevel`, `pi.setActiveTools`
- `pi.exec(command, args, options?)`
- Context: `ctx.ui`, `ctx.cwd`, `ctx.sessionManager`, `ctx.signal`, `ctx.compact(options?)`, `ctx.getContextUsage()`, `ctx.getSystemPrompt()`

### 2.8 Provider registration

```ts
pi.registerProvider("provider-name", {
  baseUrl: string,
  apiKey: "ENV_VAR" | "!shell-cmd" | literal,
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai",
  models: ProviderModelConfig[],
  headers?, authHeader?, oauth?, streamSimple?
})
```

ProviderModelConfig:
```ts
{
  id: string,
  name: string,
  reasoning: boolean,
  input: ("text" | "image")[],
  cost: { input, output, cacheRead, cacheWrite },
  contextWindow: number,
  maxTokens: number,
  thinkingLevelMap?: Record<ThinkingLevel, string | null>,
  compat?: { thinkingFormat, maxTokensField, supportsDeveloperRole, ... }
}
```

### 2.9 RPC protocol

- JSONL over stdin/stdout, **must split on `\n` only** (Node readline incompatible due to U+2028/U+2029)
- Command shape: `{id?, type, ...}`; Response: `{id, type: "response", command, success, data?, error?}`
- Methods: `prompt`, `steer`, `follow_up`, `abort`, `bash`, `set_model`, `get_available_models`, `set_thinking_level`, `get_state`, `get_messages`, `compact`, `set_auto_compaction`, `new_session`, `switch_session`, `fork`, `clone`

### 2.10 Session file format

JSONL. First line: `{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"..."}`.

Entry types (all share `{type, id, parentId, timestamp}`): `message`, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info`.

Message roles: `user`, `assistant`, `toolResult`, `bashExecution`, `custom`, `branchSummary`, `compactionSummary`.

### 2.11 Settings schema

`~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project, overrides). Fields: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `compaction.{enabled, reserveTokens, keepRecentTokens}`, `enabledModels`, `sessionDir`, `theme`, plus resource arrays (`packages`, `extensions`, `skills`, `prompts`, `themes`).

### 2.12 Pi-native compaction (NOT cache_control)

Pi has built-in conversation compaction:
```
trigger: contextTokens > contextWindow - reserveTokens (default reserve: 16384)
walk backwards until keepRecentTokens (default: 20000)
generate summary, append CompactionEntry, reload session
```

**Cache_control (Anthropic prompt caching) is provider-specific** — it lives in the provider shim (`api: "anthropic-messages"` with cost.cacheRead/cacheWrite), NOT in Pi-level compaction. The "≥70% cache hit ratio" target must be achieved via:
1. Anthropic provider config with deterministic system-prompt prefix
2. Stable message ordering (no random reorder of context blocks)
3. cache_control breakpoints set at the provider layer
4. Cost field already tracks `cacheRead`/`cacheWrite` per model

### 2.13 CLI flags (verified)

`--mode rpc|json`, `-p|--print`, `-c|--continue`, `-r|--resume`, `--session <path|id>`, `--no-session`, `--session-dir <dir>`, `--provider`, `--model <pattern>` (supports `provider/id:<thinking>` syntax), `--api-key`, `--thinking <level>`, `--models <patterns>`.

### 2.14 NOT FOUND in Pi docs (TDD.md claims)

| TDD.md term | Pi docs status | TDD2 replacement |
|---|---|---|
| `shouldStopAfterTurn` | **NOT FOUND** | Use Extension hook `agent_end` or tool return `{terminate: true}` |
| `report_result` tool | **NOT FOUND** | Build as custom tool via `pi.registerTool`; persist result via `ctx.appendEntry` |
| `cache_control` as Pi API | **NOT FOUND** at Pi level | Live in provider shim, e.g., `runtime/providers/anthropic.ts` |
| `pi-agent-core` exported types | Listed as peerDependency only | Treat as opaque internal; depend via SDK exports only |

---

## 3. Architectural deltas vs TDD.md (corrections TDD2 must make)

| Topic | TDD.md claim | Reality | TDD2 action |
|---|---|---|---|
| Pi package scope | `@mariozechner/*` | `@earendil-works/*` | Global rename in all snippets/deps |
| Methodology vendor-neutrality | "preserved unchanged" | `methodology` package currently `import`s from `codex-driver` (verified in `package.json`) | Add explicit ADR: "Break methodology→codex-driver edge before any Pi work" — gate of M1 |
| CLI vendor-neutrality | (silent / unaddressed) | `packages/cli/src/commands/vibe.ts` imports three spawner classes (Codex + ClaudeCode + Ollama); `doctor.ts` imports Codex version helper | Add as second M1 entry-gate condition: introduce `core/abstractions/SpawnerEnvironment` and rewire vibe.ts + doctor.ts off all three drivers. The 4 source imports across 2 files spanning 3 driver packages are broken in PR-01b. |
| cache_control | Pi-level concern | Provider-shim concern | Recast §7 of TDD.md around provider-layer caching; redirect through `ProviderModelConfig.cost.{cacheRead,cacheWrite}` and Anthropic's `anthropic-messages` api type |
| Subagent return protocol | "`report_result` tool wired" | Tool name not in docs | Implement as custom tool via Extension API + journal entry via `ctx.appendEntry` |
| Worktree dispatcher integration | "`shouldStopAfterTurn` integration confirmed" | Hook not in docs | Use `agent_end` hook + `{terminate: true}` tool result |
| Existing test coverage | "Vitest test suite preserved as regression baseline" (§12.4) | Only 2 tests at root; rest in `packages/*/test/` (TBD scan) | Phase B2 deeper scan needed — recon report cell needs filling |
| Layered architecture | 6 layers, strict downward | Sound, but Pi's Extension model adds horizontal hooks | Document Extension API as a controlled lateral channel; do not treat it as a layer violation |
| Provider list at M1 | "Anthropic + OpenAI shims" | Pi already supports 25+ providers natively | Recast M1: don't write provider shims; write **role→model resolver** + per-provider quirk overrides where Pi defaults are wrong |
| Worktree per task | OK | Pi sessions can be ephemeral via `--no-session` and `cwd` is constructor arg — natively fits worktree model | Plus: each worktree gets its own `~/.pi/agent/sessions/<cwd>` automatically |
| Migration script | `swt migrate --to=v3` | Reasonable | Schema-bump policy: `.swt-planning/config.json#schema_version`; migrate Zod schemas in `artifacts/` |

---

## 4. What's still TBD before drafting

- Deeper scan of `packages/*/test/` to enumerate the regression baseline test count and surfaces (1 hour of focused reading)
- Read `packages/dashboard/src/server/` routes file-by-file to enumerate every existing API surface (needs preservation list)
- Read `packages/cli/src/exit-codes.ts` for the exit-code constants TDD2 must preserve
- Read `packages/methodology/src/audit/` and `packages/methodology/src/vibe/` to confirm the phase state-machine
- Read `.github/workflows/*.yml` (5 files) to copy the CI surface into TDD2 §15 verbatim

These will be done **inline while drafting** the relevant sections, not as a separate phase — they're 5-15 line reads each.

---

## 5. Outline for TDD2.md

**Target size:** 200-300KB / 5000-7000 lines of detailed technical writing.

```
0. How to use this document (preamble, conventions)
1. Executive Summary
   1.1 Goal · 1.2 North-star metrics · 1.3 Scope · 1.4 Non-goals
   1.5 Strategy summary · 1.6 Correction log vs TDD.md
2. Architectural Principles (Constitution) — extended from TDD.md
3. Current-State Audit (v2.3.5)
   3.1 Workspace layout · 3.2 Per-package inventory (file counts, exports)
   3.3 Test coverage map · 3.4 CI/CD inventory
   3.5 Dependency graph + the methodology→codex-driver leak + the cli→{all-3-drivers} leak
   3.6 What dies on day one · 3.7 What we steal from GSD-2
4. Target Architecture
   4.1 Layered overview (corrected) · 4.2 Why a runtime adapter
   4.3 Dependency rules + test seams · 4.4 Crash-safety model
   4.5 Concurrency model (worktrees + sessions + claims)
5. Pi SDK Integration Reference (NEW — replaces TDD.md hand-waves)
   5.1 Verified API surface · 5.2 Session lifecycle and modes
   5.3 Tool model (factories, custom, Extension-registered)
   5.4 Extension architecture: when to use vs raw SDK
   5.5 Event stream contract (all event/delta types)
   5.6 Session file format (v3 schema)
   5.7 Provider registration through Extensions
   5.8 Compaction vs cache: where each lives
   5.9 RPC protocol details · 5.10 CLI flag reference
6. Module / Package Layout (v3 final)
   6.1 Package tree · 6.2 Public surface per package
   6.3 Internal interfaces · 6.4 Build/test/release tooling
7. Vendor-Agnostic Provider Abstraction
   7.1 Capability tier model · 7.2 Role→tier mapping
   7.3 Provider router strategies · 7.4 Fallback chain semantics
   7.5 Per-provider quirk shims (using Pi's `compat` field)
   7.6 Token cost calculation (using ProviderModelConfig.cost)
8. Token Optimization Architecture
   8.1 The meter · 8.2 Provider-level caching (Anthropic, OpenAI, Bedrock)
   8.3 Explicit context injection (buildPrompt) · 8.4 Budget gate
   8.5 Compaction strategy (Pi-native + when to override)
9. Worktree-Based Subagent System
   9.1 Worktree lifecycle · 9.2 Claim registry + conflict prevention
   9.3 DAG resolver · 9.4 Result protocol (Extension-based, not report_result)
   9.5 Crash recovery · 9.6 Lease locks + event recovery
10. The Six Roles, Reframed for Pi
    10.1 Role definitions · 10.2 Per-role tier defaults
    10.3 System prompt strategy · 10.4 Tool subset per role
11. Methodology Layer (Preserved + Cleaned)
    11.1 Phase lifecycle state machine
    11.2 Must-haves and goal-backward QA
    11.3 .swt-planning/ artefact schemas (Zod, version policy, migration)
    11.4 Phase routing logic
    11.5 Breaking the codex-driver edges (both methodology and cli edges; the M1 gate condition)
12. Dashboard Integration
    12.1 Existing dashboard inventory (server routes + client panels)
    12.2 SSE bridge migration to Pi events
    12.3 New panels: worktrees, cache-hit, budget, per-provider cost
    12.4 Permission gate evolution (DashboardPermissionGate vs UiPermissionGate)
    12.5 Layout-storage v2 + palette preservation
13. Migration Plan — M1-M6 (deeper than TDD.md)
    Each milestone: goal, deliverables (file-level), gates, risks, rollback, exit interview checklist
14. Test Strategy (MAJOR EXPANSION)
    14.1 Pyramid policy · 14.2 Unit tests · 14.3 Integration · 14.4 E2E
    14.5 Provider matrix · 14.6 Regression baseline (v2 golden runs)
    14.7 Cassette infrastructure (full record/replay design)
    14.8 Golden artefact bundles · 14.9 Performance (TPAC measurement)
    14.10 Chaos (crash recovery) · 14.11 Static-check ladder
    14.12 Test isolation rules · 14.13 Coverage targets
15. CI/CD Pipeline (NEW)
    15.1 GitHub Actions workflows (full YAML for each)
    15.2 PR pipeline · 15.3 Main branch pipeline · 15.4 Release pipeline
    15.5 Install-smoke matrix · 15.6 CodeQL + Vale · 15.7 Bundle budgets
    15.8 Branch protection · 15.9 Required reviews
16. Observability (NEW)
    16.1 Structured logging · 16.2 Metrics · 16.3 Tracing
    16.4 Dashboards · 16.5 Telemetry boundary
17. Release Process (NEW)
    17.1 Versioning · 17.2 Changesets · 17.3 RCs
    17.4 Provenance + signed tags · 17.5 Rollback · 17.6 LTS for v2.x
18. Documentation Strategy (NEW)
    18.1 In-tree docs/ · 18.2 API reference generation
    18.3 Migration guide (v2.x → v3.0) · 18.4 ADRs · 18.5 Vale enforcement
19. Risk Register (expanded with 20+ rows)
20. Decision Log (expanded)
21. Open Questions
22. ADR Seeds (concrete stubs for ~12 ADRs)
23. Appendices
    A. Verified Pi API quick-reference card
    B. v2.3.5 → v3.0 file migration table
    C. Glossary
    D. Reference repo specification for TPAC benchmark
    E. Changelog of corrections vs TDD.md
```

---

## 6. Drafting plan

| Batch | Sections | Estimated bytes | Notes |
|---|---|---|---|
| C1 | 0, 1, 2 | ~15KB | Foundation: preamble + exec summary + constitution |
| C2 | 3, 4, 5 | ~50KB | Heaviest factual section: full v2 audit + target arch + verified Pi reference |
| C3 | 6, 7, 8 | ~35KB | Package layout, provider abstraction, token optimization |
| C4 | 9, 10, 11 | ~30KB | Worktree subagents, six roles, methodology layer |
| C5 | 12, 13 | ~30KB | Dashboard, M1-M6 milestones |
| C6 | 14, 15 | ~45KB | Test strategy + CI/CD (both deeply expanded) |
| C7 | 16, 17, 18 | ~25KB | Observability + release + docs |
| D | 19, 20, 21, 22, 23 | ~25KB | Risk + decisions + ADR seeds + appendices |

**Total estimate:** ~255KB / 6000 lines.
