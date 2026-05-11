# TDD: SWT v3 — Pi-Native, Vendor-Agnostic, Worktree-Isolated Coding Harness

> **Document type**: Technical Design Document & Implementation Blueprint
> **Status**: Draft v1.0 — Authoritative for the v3 milestone
> **Audience**: Lead developer executing the rewrite; reviewers approving milestones
> **Last updated**: 2026-05-11

---

## 0. How to use this document

This is the master plan for rewriting `stop-wasting-tokens` (SWT) on top of the Pi SDK, in place on `main`. It is **prescriptive** where decisions have been made, **directive** about test gates, and **explicit** about what to delete.

Conventions used throughout:

- **MUST / SHOULD / MAY** follow RFC 2119 strictness.
- "**P0**" = required for v3.0 ship. "**P1**" = required within one minor release. "**P2**" = nice-to-have, defer.
- Code sketches are illustrative TypeScript using Pi's actual SDK names. They compile in spirit, not necessarily on first paste — treat them as the shape of what the file should look like.
- Where you encounter ambiguity not resolved here, record the decision in `docs/decisions/ADR-NNN.md` and reference it in the matching PR.

The document is living. Material deviations need a PR amending the TDD before code; minor scoping decisions go in ADRs.

---

## 1. Executive Summary

### 1.1 Goal

Rebuild SWT as a **vendor-agnostic, Pi-native coding harness** that ships measurably fewer tokens per acceptance criterion than naive Codex CLI / Claude Code / equivalent harnesses on the same workload — while preserving SWT's methodology (six-agent SDLC, planning artefacts, goal-backward QA).

### 1.2 North-star metric

**Tokens per shipped acceptance criterion (TPAC)**, measured against a fixed reference repo and milestone:

| Metric | Baseline (current SWT + Codex CLI) | v3.0 target | v3.x stretch |
|---|---|---|---|
| TPAC (input + output combined) | TBD: measured M1 | **−40%** | **−60%** |
| Cache hit ratio | not measured | **≥70%** on Anthropic paths | ≥80% |
| Wall-clock per phase | baseline | parity | −20% via parallelism |
| Cost per acceptance criterion (USD) | baseline | **−50%** | −70% |

These numbers are not aspirational marketing. They are **acceptance criteria for v3.0**. If we cannot demonstrate them on a public benchmark by M6 close, v3.0 does not ship.

### 1.3 Scope

**In scope:**

- Full rewrite of the runtime layer to use `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`.
- Vendor-agnostic provider/role abstraction (Anthropic, OpenAI/Codex, OpenRouter, Gemini, GLM, Kimi, local via Ollama/vLLM).
- Git-worktree-isolated subagent dispatch with declared file claims and DAG-based parallel execution.
- Token-meter instrumentation surfaced to the dashboard.
- Preservation of the methodology layer (`.swt-planning/` artefacts, phase lifecycle, six roles, must-haves, QA tiers).
- Migration of the existing Hono + Solid + SSE dashboard to consume Pi events.

**Out of scope (for v3.0):**

- Claude Code or Codex CLI as a "backend". They are deleted, not coexisting.
- Hosted/cloud dashboard. Localhost only, same as today.
- Team coordination features beyond what GSD-2 has demonstrated (`.swt-planning/parallel/` IPC).
- Mobile/IDE-plugin UIs beyond what the current TUI/dashboard provide.

### 1.4 Non-goals

We are **not** building "a better Codex CLI". We are building a methodology layer that happens to run on a vendor-agnostic agent runtime. The methodology — not the agent — is the product. If the project ever resembles a generic coding agent, the design has drifted.

### 1.5 Strategy summary

1. **Delete the Codex subprocess path entirely.** It is a workaround for not owning the runtime; v3 owns the runtime.
2. **Adopt Pi's `createAgentSession()` as the only runtime primitive.** No reinvention.
3. **Treat subagents as processes-in-worktrees**, not as LLM features. Worktrees give us isolation; Pi gives us per-session model selection; together they give us parallel + multi-provider as a first-class capability.
4. **Build the meter first.** Token instrumentation lands before any optimization claim is made. We measure before we tune.
5. **Methodology is provider-agnostic from day one.** Role profiles describe *capability tiers* (cheap-fast, balanced, quality, reasoning), not specific models. Tier→model resolution happens at the runtime layer.

---

## 2. Architectural Principles (Constitution)

These principles are load-bearing. Any design decision that violates them needs an ADR justifying the exception, signed off in a PR.

1. **The methodology layer is the IP.** Anything in `.swt-planning/` is sacred. Artefact schemas, phase lifecycle, six-role split, must-haves, goal-backward QA — preserved. Code that touches these MUST be vendor-agnostic.

2. **The runtime layer is replaceable.** Today: Pi. Tomorrow: maybe something else. Code that calls Pi APIs lives behind a thin internal interface (`runtime/`) so a future swap is mechanical, not architectural.

3. **The provider is a parameter, not a backbone.** No file in the repo SHOULD have "anthropic" or "openai" or "codex" in its name outside of `runtime/providers/`. Provider-specific quirks are normalized at the boundary.

4. **Subagents are processes, not LLM features.** The orchestrator owns the process lifecycle, the working directory, the model selection, and the result protocol. The LLM inside the subagent does not know it's a subagent.

5. **Token efficiency is measurable, not folkloric.** Every decision that claims "saves tokens" MUST come with a benchmark scenario and a number. If you can't measure it, it doesn't ship.

6. **Static checks before LLM calls, always.** The verification ladder runs zero-token checks first. LLM-based QA is the escalation, not the default.

7. **Fresh sessions per task by default.** Context accumulation is the enemy. New session per Dev task, per Scout query, per Architect decision. Compaction is a last resort, not a strategy.

8. **The dashboard is the primary UX.** v2.0 set this direction; v3 doubles down. The CLI exists for headless / CI / power-user fallback. New features land in the dashboard first.

9. **Crash-safety is non-negotiable.** Any operation that creates a worktree, an LLM session, or a long-running process MUST be resumable from disk state after a kill -9. Lock files + PID liveness + structured journals everywhere.

10. **Compose, don't fork.** When Pi gains a feature, we use it. When Pi has a bug, we file an issue and possibly carry a patch — we don't fork the SDK.

---

## 3. Current-State Audit

### 3.1 What SWT is today

A TypeScript monorepo (pnpm workspaces, ESM-only, Vitest, tsup) that wraps the OpenAI Codex CLI as a subprocess and orchestrates a six-agent methodology over it. Key artefacts:

| Concern | Location | State after migration |
|---|---|---|
| Methodology engine (phases, roles, artefacts) | core SWT logic | **PRESERVED** — moved into `packages/core/` |
| Codex subprocess invocation | `*-backend-codex.ts`, related glue | **DELETED** |
| `.codex-plugin/` Codex MCP wiring | `.codex-plugin/` | **DELETED** |
| Codex AGENTS.md generation | per-agent TOML/MD generators | **DELETED** (replaced by Pi system-prompt overrides) |
| Dashboard (Hono + Solid + SSE + chokidar) | `packages/dashboard/` (assumed) | **PRESERVED + EXTENDED** |
| Permission gate, layout-storage v2, palette | dashboard internals | **PRESERVED** |
| `.swt-planning/` artefact pipeline | filesystem schema | **PRESERVED, UNCHANGED** |
| `.vbw-planning/` references (legacy) | CLAUDE.md and similar | **CLEANED** (single canonical name: `.swt-planning/`) |
| 22 stub CLI verbs | `swt {verb}` returning `EXIT.NOT_IMPLEMENTED` | **CULLED** to ~5 real verbs; the rest deleted, not stubbed |
| Vitest test suite | `test/` | **PRESERVED** as regression baseline (see §12.4) |

### 3.2 What dies on day one

- Anything reading or writing `~/.codex/config.toml`
- Anything that spawns `codex exec` or similar subprocesses
- The `backend: codex | claude-code | ollama` config field (replaced by vendor-agnostic role profiles)
- Codex-specific OAuth handling (Pi handles OAuth uniformly)
- Stub CLI verbs that return "not yet implemented"
- Any references to "GSD" or "VBW" in code paths (legacy plugin isolation in CLAUDE.md — clean up)

### 3.3 What we steal from GSD-2

GSD-2 (also Pi-based) has already proven several patterns we will adopt verbatim:

- Per-task fresh sessions with explicit context inlining
- Git worktree per milestone (we extend to per-task)
- `.gsd/parallel/` file-IPC pattern (we adopt as `.swt-planning/parallel/`)
- PID liveness checks for crash recovery
- Headless mode with structured exit codes (0/1/2)
- HTML report generation post-milestone
- `verification_commands` for static-check gates

We do not copy GSD-2 wholesale. We take the patterns and integrate them with SWT's existing methodology surface.

---

## 4. Target Architecture

### 4.1 Layered overview

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Public Surface                                    │
│  CLI verbs · Headless mode · RPC mode · SDK exports         │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Dashboard                                         │
│  Hono server · Solid SPA · SSE bridge · Permission gate     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Methodology (PRESERVED FROM v2)                   │
│  Phase lifecycle · Roles · Artefacts · Must-haves · QA tiers│
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Orchestration                                     │
│  Worktree dispatcher · DAG resolver · Result harvester      │
│  Role→tier→model resolver · Budget enforcer · Token meter   │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Runtime Adapter (thin interface over Pi)          │
│  Session factory · Tool factory · Event normalization       │
│  Cache-control insertion · Provider quirk shims             │
├─────────────────────────────────────────────────────────────┤
│  Layer 0: Pi SDK (external dependency)                      │
│  pi-coding-agent · pi-agent-core · pi-ai                    │
└─────────────────────────────────────────────────────────────┘
```

**Dependency direction is strictly downward.** Layer 3 (methodology) never imports from Layer 4 (dashboard). Layer 1 (runtime adapter) never imports from Layer 3 (methodology). The interfaces between layers are the test seams.

### 4.2 Why a runtime adapter (Layer 1) instead of using Pi directly

Three reasons:

1. **Testability.** Mocking Pi at the Layer 1 interface lets the entire methodology layer be unit-tested without LLM calls.
2. **Cross-cutting concerns.** Cache-control insertion, token metering, cost aggregation, and budget enforcement happen here — once — not scattered across the orchestrator.
3. **Future-proofing.** If Pi's API changes substantially (it's pre-1.0), the change is localized.

The adapter is **thin**. It does not reinvent Pi concepts; it normalizes them. Rule of thumb: if a function in `runtime/` is more than 50 lines, ask whether it's leaking methodology into the adapter.

---

## 5. Module / Package Layout

Pnpm workspace, ESM-only, TypeScript strict mode.

```
packages/
├── core/                      # Layer 3 — methodology (preserved + cleaned)
│   ├── src/
│   │   ├── phases/            # phase lifecycle state machine
│   │   ├── roles/             # six-role definitions + capability tiers
│   │   ├── artefacts/         # .swt-planning/ schema + I/O
│   │   ├── must-haves/        # goal-backward verification primitives
│   │   ├── qa-tiers/          # quick/standard/deep tier definitions
│   │   └── state-machine/     # phase routing logic
│   └── test/                  # Vitest unit tests
│
├── runtime/                   # Layer 1 — Pi adapter
│   ├── src/
│   │   ├── session.ts         # createSession() — thin wrapper around Pi
│   │   ├── tools.ts           # tool factories scoped to a cwd
│   │   ├── events.ts          # Pi event → normalized event mapping
│   │   ├── cache-control.ts   # provider-specific cache-control insertion
│   │   ├── token-meter.ts     # token + cost aggregation per session
│   │   ├── budget-gate.ts     # global + per-role budget enforcement
│   │   └── providers/         # provider quirk shims
│   │       ├── anthropic.ts
│   │       ├── openai.ts
│   │       ├── openrouter.ts
│   │       └── ...
│   └── test/
│
├── orchestration/             # Layer 2 — dispatcher and DAG
│   ├── src/
│   │   ├── worktree-manager.ts
│   │   ├── dispatcher.ts      # spawns subagents, harvests results
│   │   ├── dag-resolver.ts    # depends_on → parallel batches
│   │   ├── claim-registry.ts  # file-claim conflict prevention
│   │   ├── result-protocol.ts # JSON schema for subagent returns
│   │   ├── role-resolver.ts   # role → tier → concrete model
│   │   └── lock-files.ts      # PID liveness + crash recovery
│   └── test/
│
├── dashboard/                 # Layer 4 — Hono + Solid + SSE (preserved + extended)
│   ├── src/
│   │   ├── server/            # Hono routes, SSE bridge, permission gate
│   │   ├── client/            # Solid SPA
│   │   └── shared/            # protocol types shared with client
│   └── test/
│
├── cli/                       # Layer 5 — verb surface
│   ├── src/
│   │   ├── verbs/             # one file per verb (init, vibe, status, ...)
│   │   ├── headless/          # CI-friendly entrypoints
│   │   ├── rpc/               # JSON-RPC mode (delegates to Pi's runRpcMode)
│   │   └── doctor/            # environment checks
│   └── test/
│
├── shared/                    # cross-package types + utils
│   ├── src/
│   │   ├── types/             # shared TypeScript types
│   │   ├── schemas/           # Zod schemas (single source of truth)
│   │   └── util/
│   └── test/
│
└── test-utils/                # test fixtures + cassette infra (private)
    ├── src/
    │   ├── cassettes/         # recorded LLM responses (see §12.4)
    │   ├── fixtures/          # synthetic projects, milestones, plans
    │   ├── mocks/             # mock implementations of runtime interfaces
    │   └── golden/            # reference artefact bundles
    └── test/
```

### 5.1 Why split runtime from orchestration

The runtime adapter (Layer 1) is **stateless per-call**. It creates a session, returns it, owns no state. The orchestration layer (Layer 2) holds the state: which worktree, which claim, which DAG node, which retry. Mixing them is the single most common architectural mistake in coding-agent codebases — keep them apart.

### 5.2 What package.json's `bin` field points at

A single CLI entrypoint: `packages/cli/bin/swt.mjs`. The dashboard daemon is a subcommand (`swt dashboard`), not a separate binary. Same as today.

### 5.3 Build, test, release tooling

- **Bundler**: `tsup` (already in use). One bundle per package; `cli/` is the published entrypoint.
- **Test**: `vitest` (already in use). Per-package config extending root `vitest.config.ts`. See §12.
- **Lint/format**: `eslint` + `prettier` (already configured). Strict rules; no warnings allowed in CI.
- **Release**: `changesets/action` (already wired). Conventional commits.
- **Lockfile**: `pnpm-lock.yaml` (already in use). Frozen in CI.

---

## 6. Vendor-Agnostic Provider Abstraction

### 6.1 The capability-tier model

The methodology layer **does not name models**. It names tiers. The runtime layer resolves tier→model based on provider availability and configuration.

| Tier | Use case | Example mapping per provider |
|---|---|---|
| `cheap-fast` | Scout queries, simple completions, classification | Anthropic: Haiku · OpenAI: gpt-5-mini · GLM: glm-5-air |
| `balanced` | Dev tasks, QA verification, Lead coordination | Anthropic: Sonnet · OpenAI: gpt-5 · GLM: glm-5 |
| `quality` | Architect decisions, design trade-offs | Anthropic: Opus · OpenAI: gpt-5-pro · GLM: glm-5-max |
| `reasoning` | Debugger, deep root-cause analysis | Anthropic: Opus + thinking=high · OpenAI: o-series · DeepSeek-R1 |

Tier mapping per provider lives in `runtime/providers/<provider>.ts` as a static object. Updating model lists is a single-file change.

### 6.2 Role → tier mapping (default)

| Role | Default tier | Notes |
|---|---|---|
| Scout | `cheap-fast` | Isolated subagent; returns compressed findings |
| Architect | `quality` | Isolated; produces plan artefact |
| Lead | `balanced` | Shares session with Dev for coordination |
| Dev | `balanced` | Per-task fresh session |
| QA | `balanced` | Preceded by static checks; only runs if static passes |
| Debugger | `reasoning` | Isolated; hypothesis-driven |

User MAY override per-role tier or pin a specific model in `.swt-planning/config.json`.

### 6.3 Provider configuration

```jsonc
// .swt-planning/config.json — illustrative
{
  "version": 3,
  "providers": {
    "primary": "anthropic",
    "fallbacks": ["openai", "openrouter/glm-5"]
  },
  "roles": {
    "scout":     { "tier": "cheap-fast" },
    "architect": { "tier": "quality", "thinkingLevel": "high" },
    "lead":      { "tier": "balanced" },
    "dev":       { "tier": "balanced" },
    "qa":        { "tier": "balanced" },
    "debugger":  { "tier": "reasoning", "thinkingLevel": "high" }
  },
  "budget": {
    "ceiling_usd": 50.00,
    "pressure_thresholds": [0.5, 0.75, 0.9]   // downgrade tiers at these fractions
  }
}
```

### 6.4 Auth and OAuth posture

API keys are the **first-class** path. OAuth is opt-in per provider and clearly marked as ToS-risky for Anthropic and Google (see SECURITY.md). Pi's `AuthStorage` handles both transparently.

Priority order (delegated to Pi):
1. Runtime override (process flag)
2. `~/.swt/auth.json` (Pi's `auth.json` mounted at SWT's config dir)
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
4. Custom provider fallback resolver (for self-hosted endpoints)

**No credentials live in `.swt-planning/`**, ever. Project config is committable; auth is not.

### 6.5 Provider quirk normalization (the boundary work)

Each provider has subtle differences in:

- Cache-control mechanism (Anthropic: `cache_control` blocks · OpenAI: prompt prefix caching automatic · Gemini: context caching API)
- Structured output (Anthropic: tool-use · OpenAI: `response_format` / strict mode · Gemini: function calling)
- Tool-call streaming format
- Token counting in response headers
- Rate-limit error shapes

Pi normalizes most of this. What Pi doesn't normalize, we normalize in `runtime/providers/<provider>.ts`. The internal contract for Layer 2 and above: providers look identical. If a provider quirk is leaking into orchestration, that's a bug — fix the shim.

---

## 7. Token Optimization Architecture

This is where the product earns its name. Each lever below has a measurement strategy (see §12.5).

### 7.1 Explicit context injection

**Problem**: Today SWT hopes Codex caches `.swt-planning/` artefacts. With Pi, we control the prompt.

**Solution**: Every agent dispatch constructs its prompt deterministically:

```
[ SYSTEM ]                           ← cached, stable across all dispatches
[ AGENT-ROLE PROMPT ]                ← cached, stable per role
[ PROJECT.md ]                       ← cached, stable per milestone
[ REQUIREMENTS.md ]                  ← cached, stable per milestone
[ MILESTONE CONTEXT (M-RES.md) ]     ← cached, stable per milestone
[ PHASE CONTEXT (P-PLAN.md) ]        ← cached, stable per phase
[ TASK-SPECIFIC TAIL ]               ← varies — the only non-cached part
```

Cache-control breakpoints inserted between each block (Anthropic) or relied on automatically (OpenAI). The tail is small (typically <2k tokens). Everything above is paid for once per milestone.

**Implementation**: `runtime/cache-control.ts` exports a `buildPrompt(role, milestone, phase, task) → MessagesWithCacheControl[]` function. Tested against a recorded artefact bundle to assert message structure is byte-for-byte identical between dispatches (except the tail).

### 7.2 Per-task fresh sessions

**Problem**: Codex CLI accumulates context across a long-running session. Long tasks → long context → high marginal token cost per turn.

**Solution**: Every Dev task gets `SessionManager.inMemory()` — fresh window. The dispatcher injects the (cached) artefact bundle as the system+user preamble; the task runs to completion in 200k window; result harvested; session disposed.

```typescript
// orchestration/dispatcher.ts — sketch
async function dispatchDevTask(task: Task, worktreePath: string): Promise<TaskResult> {
  const model = resolveModel("dev", config);
  const tools = createCodingTools(worktreePath);    // Pi factory, cwd-scoped
  const { session } = await createAgentSession({
    cwd: worktreePath,
    model,
    tools,
    sessionManager: SessionManager.inMemory(),       // ephemeral, no disk
    resourceLoader: buildLoaderFor(task, "dev"),     // injects cached prefix
  });

  const meter = attachTokenMeter(session);            // see §7.7
  const harvester = attachResultHarvester(session);   // see §8.4

  await session.prompt(buildTaskPrompt(task));        // the only varying tail

  const result = await harvester.collect();
  const cost = meter.snapshot();
  session.dispose();

  return { ...result, cost };
}
```

### 7.3 Subagent dispatch for research

**Problem**: Scout's job is research. Its output (raw codebase searches, web fetches) pollutes the parent's context forever.

**Solution**: Scout runs as a **subagent** in its own session, returns a compressed finding (target: <500 tokens), parent never sees the raw search noise.

Pi's `createAgentSession()` makes this trivial — Scout is just another session with different tools (`readOnlyTools`) and a different system prompt. The parent orchestrator awaits the structured result.

### 7.4 MCP-first ambient context

**Problem**: Pi's default tool set (read, write, edit, bash) is generic. Specialty operations (library docs, web search, structured codebase queries) burn parent-agent tokens when invoked directly.

**Solution**: Ambient operations go through MCP servers, called by **subagents only**. The parent never has these tools in its tool list. Examples:

- Context7 MCP for library/framework docs
- Brave or Tavily MCP for web research
- A custom `swt-codebase-mcp` (P1) that exposes the brownfield `codebase/` map as queries

Pi has native MCP client support (see `pi-coding-agent` README). We configure MCP servers per-role in the resource loader.

### 7.5 Verification ladder

**Problem**: "QA" today often means an LLM call. Most QA needs are zero-token.

**Solution**: Per-phase verification ladder, executed in order, fail-fast:

1. **Static checks** (zero LLM): `verification_commands` from config — lint, types, unit tests, custom scripts.
2. **Must-haves verification** (zero LLM): assert files exist, exports present, imports wire up. Done by inspecting Dev's `details` payload.
3. **Behavioral verification** (LLM if needed): run UAT script; if it cannot be expressed mechanically, escalate to LLM QA agent.
4. **Semantic verification** (LLM): only invoked when 1-3 pass but human judgment is still needed. Rare.

`packages/core/src/qa-tiers/` defines the ladder. Tier (`quick`/`standard`/`deep`) controls which rungs are mandatory.

### 7.6 Streaming + early termination

**Problem**: A rambling model burns output tokens. We can't stop Codex CLI mid-stream; we can stop Pi.

**Solution**: Subscribe to Pi's `message_update` events; if the assistant emits a stuck-pattern (repeated tool calls on same file, output without progress markers, hallucinated path patterns), call `session.abort()`. Re-dispatch with corrective prompt.

`orchestration/dispatcher.ts` includes a `StuckDetector` that runs over the streaming event flow. Configurable thresholds; off by default for v3.0, opt-in via config; promoted to default in v3.1 once tuned.

### 7.7 Budget enforcement (not advisory)

**Problem**: Today `effort: turbo` is a vibe. We make it real.

**Solution**: Token meter (`runtime/token-meter.ts`) aggregates input/output/cache-hit tokens per session, per role, per milestone. `BudgetGate` enforces:

- **Hard ceiling**: refuses to dispatch new turns when global budget hit. Pauses milestone, surfaces in dashboard.
- **Pressure thresholds**: at 50%/75%/90% of budget, downgrade tier of subsequent dispatches (e.g., `quality → balanced → cheap-fast`).
- **Per-role caps**: optional per-role token cap; prevents one runaway Architect call from blowing the milestone.

Real-time numbers flow to the dashboard via SSE.

### 7.8 Compaction as last resort

Pi has `session.compact()`. We **do not** rely on it as a default strategy. If a Dev task is large enough that a fresh session can't hold it, the task is too large — split it. Compaction only fires automatically in interactive long-running flows where the user expects continuity.

---

## 8. Worktree-Based Subagent System

### 8.1 Mental model

A **subagent** is a process. It happens to consult an LLM internally. The orchestrator owns:

- The working directory (a git worktree)
- The model assignment
- The tool list (cwd-scoped Pi tools)
- The system prompt (via Pi's `DefaultResourceLoader`)
- The structured result protocol
- The lifecycle (spawn → wait → harvest → cleanup)

The LLM inside knows none of this. It sees a working directory, has tools, and is told what to do.

### 8.2 Worktree lifecycle

```
┌───────────────┐
│ DAG Resolver  │ — reads slice plan, returns independent batches
└───────┬───────┘
        │
        v
┌───────────────┐     git worktree add .swt-planning/worktrees/<id>
│ Claim Registry│ <─  -b agent/<milestone>/<phase>/<task-id>
└───────┬───────┘
        │
        v
┌───────────────┐     createAgentSession({ cwd, model, tools, ... })
│  Dispatcher   │ ──> [ subagent runs in worktree, emits events ]
└───────┬───────┘
        │
        v
┌───────────────┐     collect result via custom report-result tool
│   Harvester   │ ──> { diff, summary, must-haves: [...], status }
└───────┬───────┘
        │
        v
┌───────────────┐     git diff → decide → merge --squash || discard
│ Merge Orchestr│ ──> if conflict: escalate or retry
└───────┬───────┘
        │
        v
┌───────────────┐     git worktree remove .swt-planning/worktrees/<id>
│   Cleanup     │     update claim registry, persist final cost
└───────────────┘
```

### 8.3 Worktree layout on disk

```
.swt-planning/
├── parallel/                          # IPC + state
│   ├── claims.json                    # active file claims by task id
│   ├── locks/
│   │   └── <task-id>.lock             # PID + start time + worktree path
│   ├── status/
│   │   └── <task-id>.json             # live status (heartbeat from subagent)
│   └── cost/
│       └── <task-id>.jsonl            # streamed token/cost events
├── worktrees/                         # git worktree checkout roots (gitignored)
│   └── <task-id>/                     # actual repo checkout
└── milestones/01-<slug>/phases/01-<slug>/tasks/<task-id>/
    ├── PLAN.md
    ├── SUMMARY.md          (post-run)
    └── DIFF.patch          (post-run, for review)
```

`.gitignore` MUST exclude `.swt-planning/parallel/locks/`, `.swt-planning/parallel/status/`, `.swt-planning/worktrees/`. Everything else is committable artefact.

### 8.4 The Result Protocol

A subagent reports completion via a **dedicated tool** (`report_result`), not by emitting final text. This makes harvesting structural, not parsed-from-prose.

```typescript
// orchestration/result-protocol.ts
import { Type } from "@sinclair/typebox";

export const TaskResultSchema = Type.Object({
  status: Type.Union([
    Type.Literal("success"),
    Type.Literal("partial"),
    Type.Literal("blocked"),
    Type.Literal("failed"),
  ]),
  summary: Type.String({ maxLength: 2000 }),    // hard cap forces compression
  must_haves: Type.Array(Type.Object({
    id: Type.String(),
    description: Type.String(),
    verified: Type.Boolean(),
    evidence: Type.Optional(Type.String()),
  })),
  files_touched: Type.Array(Type.String()),
  decisions_made: Type.Optional(Type.Array(Type.String())),
  blocked_by: Type.Optional(Type.String()),
  follow_ups: Type.Optional(Type.Array(Type.String())),
});

export const reportResultTool: ToolDefinition = {
  name: "report_result",
  label: "Report task result",
  description: "Call this exactly once when the task is complete or blocked. " +
               "After this call, your turn ends and the orchestrator harvests your result.",
  parameters: TaskResultSchema,
  execute: async (toolCallId, params, _onUpdate, ctx) => {
    // Signal the harvester
    ctx.metadata.set("task_result", params);
    return {
      content: [{ type: "text", text: "Result recorded. Task complete." }],
      details: {},
    };
  },
};
```

The dispatcher attaches this tool to every subagent. The harvester (`shouldStopAfterTurn` callback) reads the metadata and returns `{ stop: true }`. Clean termination.

### 8.5 Claim registry (conflict prevention)

Before a task dispatches, its plan declares **expected file claims**. The claim registry checks for conflicts with other in-flight tasks.

```typescript
// .swt-planning/parallel/claims.json
{
  "version": 1,
  "active": {
    "T03": {
      "worktree": "agent/M001/S01/T03",
      "pid": 12345,
      "files": ["src/auth.ts", "src/middleware/jwt.ts"],
      "started_at": "2026-05-11T14:23:00Z"
    },
    "T04": {
      "worktree": "agent/M001/S01/T04",
      "pid": 12346,
      "files": ["tests/auth.test.ts"],
      "started_at": "2026-05-11T14:23:05Z"
    }
  }
}
```

`claim-registry.ts` exposes:

- `claim(taskId, files[], worktree, pid): Result<void, ClaimConflict>` — atomic via file lock on `claims.json`.
- `release(taskId): void`
- `conflicts(files[]): TaskId[]` — read-only check before dispatch.

If a task tries to edit a file outside its claims, the `editTool` rejects (we wrap Pi's edit tool with a claim-check decorator). Hard enforcement, not soft.

### 8.6 DAG resolver (parallel batches)

Slice plans declare `depends_on` per task. The DAG resolver returns batches of independent tasks for parallel dispatch.

```typescript
// orchestration/dag-resolver.ts
export function resolveBatches(tasks: Task[]): Task[][] {
  // Topological sort by depends_on, group into levels.
  // Each level = one batch dispatched in parallel.
  // Within a batch, no task depends on any other in the same batch.
}
```

Tasks without explicit `depends_on` default to the dependency graph implied by `claims` overlap — if T03 claims `auth.ts` and T05 claims `auth.ts`, T05 implicitly depends on T03 even if its plan doesn't say so. The dispatcher will not run them in parallel.

### 8.7 Multi-provider parallelism

The dispatcher can route each subagent in a batch to a different provider. Strategies (configurable, default = `round-robin`):

- `pinned`: always primary provider; only use fallback on hard error.
- `round-robin`: distribute across configured providers; load-balances rate limits.
- `tier-routed`: cheap-fast → cheapest provider; quality → best provider per tier.
- `cost-optimized`: weight by per-token cost from a live price table.

`runtime/providers/router.ts` implements all four. Provider selection is logged per task for cost-attribution reports.

### 8.8 Crash recovery

For each in-flight task:

- A `locks/<task-id>.lock` file holds `{ pid, started_at, worktree, last_heartbeat }`.
- The subagent's event subscription writes a heartbeat every 5 seconds.
- On orchestrator startup, scan `locks/`; for each, check PID liveness. Dead → recover.

Recovery flow:

1. Read the worktree state (last commit, working dir status).
2. Read `status/<task-id>.json` (last known phase, last successful tool call).
3. Build a recovery prompt: "You were working on X. You last completed Y. Continue from Z."
4. Resume in a **new** session (do not restore the dead one).

Pi's session forking does not survive a process crash because `SessionManager.inMemory()` was used. That's a deliberate trade-off — disk I/O per turn would tank performance. Recovery is reconstruction, not resumption.

### 8.9 Cost aggregation per worktree

Every subagent attaches a token meter that streams events to `.swt-planning/parallel/cost/<task-id>.jsonl`:

```
{"t":"2026-05-11T14:23:01Z","event":"turn_end","input":1234,"output":456,"cache_read":890,"cost_usd":0.0123,"model":"claude-sonnet-4-6"}
```

The orchestrator aggregates these into `STATE.md` cost lines, and into the dashboard's cost panel. Per-provider attribution is computed by grouping on `model`.

---

## 9. The Six Roles, Reframed for Pi

The methodology stays; the runtime changes. Mapping table:

| Role | Session strategy | Tools | System prompt source | Returns |
|---|---|---|---|---|
| Scout | Isolated subagent, fresh session | `readOnlyTools`, optional MCP | `core/roles/scout.md` | Compressed finding via `report_result` |
| Architect | Isolated subagent, fresh session | `readOnlyTools` + `writeTool` (for plan artefact) | `core/roles/architect.md` | Plan artefact + `report_result` |
| Lead | Long-running session, may dispatch Dev tasks | `codingTools` + `dispatch_dev_task` (custom) | `core/roles/lead.md` | Task summaries; coordinates next moves |
| Dev | Per-task fresh session in worktree | `createCodingTools(worktreePath)` + `report_result` | `core/roles/dev.md` | Diff + must-haves verification |
| QA | Conditional (static checks first) | `readOnlyTools` + verification tool | `core/roles/qa.md` | Pass/fail per must-have |
| Debugger | Isolated, reasoning tier, thinking=high | `codingTools` (read-only by default) | `core/roles/debugger.md` | Root cause hypothesis + suggested fix |

### 9.1 Why Lead is special

Lead is the only role that **shares a session across multiple turns of work** within a phase. It exists to maintain phase-level continuity: "you just finished T03, next is T04, here's what changed."

But Lead does **not** execute Dev tasks itself. It dispatches them via the `dispatch_dev_task` custom tool, which spawns a new Pi session in a worktree. Lead's session keeps the cached phase context; Dev sessions are ephemeral.

This is the key shape: **Lead is the orchestrator's hand inside the LLM**; Dev is the worker. Different processes, different contexts, different token budgets.

### 9.2 System prompts as resources, not strings

Role system prompts live in `packages/core/src/roles/*.md` and are loaded via Pi's `DefaultResourceLoader.systemPromptOverride`. Markdown so they're reviewable as diffs. One file per role. Versioned. Tested for stability (see §12.4 golden artefacts).

---

## 10. Dashboard Integration

### 10.1 What changes vs v2.x

The dashboard infrastructure (Hono server, Solid SPA, SSE bridge, permission gate, layout-storage, cmd-K palette) is **preserved**. What changes:

- The **event source**. v2.x scrapes Codex CLI subprocess output. v3 subscribes to Pi events via the runtime adapter.
- The **panel set**. New panels for token meter, per-provider cost, worktree status, DAG view.
- The **headline metric**. "Tokens per acceptance criterion" replaces wall-clock as the primary KPI on the dashboard home.

### 10.2 Event bridge

```typescript
// dashboard/server/sse-bridge.ts — sketch
import { createEventBus } from "@mariozechner/pi-coding-agent";

const bus = createEventBus();   // shared across all sessions

// Every dispatched session passes this bus to its DefaultResourceLoader
// Pi forwards events; runtime/events.ts normalizes them; dashboard re-emits as SSE.

bus.on("turn_end", (e) => sseClients.broadcast({
  type: "cost",
  task_id: e.taskId,
  input: e.usage.input_tokens,
  output: e.usage.output_tokens,
  cache_read: e.usage.cache_read_input_tokens ?? 0,
  cache_write: e.usage.cache_creation_input_tokens ?? 0,
  cost_usd: computeCost(e.usage, e.model),
  model: e.model,
  provider: providerOf(e.model),
}));
```

### 10.3 New dashboard panels (P0 for v3.0)

| Panel | Source | Purpose |
|---|---|---|
| Token Meter | SSE stream from token-meter | Live input/output/cache breakdown, per-role, per-provider |
| Cache Hit Ratio | Aggregated from turn_end events | The single most important number for "are we saving tokens?" |
| Worktree Map | claim registry + lock files via chokidar | Live view of which tasks are running in which worktrees, with which models |
| DAG View | slice plan + active claims | Visualize the dependency graph; highlight running batches |
| Cost by Provider | aggregated turn_end events | Where the money is going |
| Budget Gauge | Budget Gate state | How close to ceiling, current pressure threshold |

### 10.4 New dashboard panels (P1, v3.1)

- TPAC History (across milestones) — the proof artifact
- Provider Health (live latency / error rate) — informs routing decisions
- Diff Preview (per-task post-harvest) — review before merge

### 10.5 Layout storage migration

Current: `layout-storage v2` (5-column main + tools array).

New: `layout-storage v3` adds a "live" column (token meter, worktree map). Migration is automatic; v2 layouts are upgraded in place on first load. Migration code lives in `dashboard/client/migrations/v2-to-v3.ts` with unit tests.

### 10.6 Permission gate (no change)

Mutation endpoints (`POST /api/config`, `POST /api/dispatch`, etc.) still go through `DashboardPermissionGate`. UI clicks that bypass session-keyed gating (the v2.3 deviation) continue to need a `UiPermissionGate` — that's a P1 follow-up tracked in the existing roadmap.

---

## 11. Migration Plan — Milestones

Each milestone ends with a **measurable gate**. No gate met = no merge to main.

### M1 — Foundation (target: 2 weeks)

**Goal**: Pi integration scaffolded; vendor abstraction proven; methodology layer extracted intact.

**Deliverables**:
- `packages/core/` extracted with all methodology logic, no Pi/Codex references.
- `packages/runtime/` with `createSession()`, `createTools()`, event normalization, token meter.
- `packages/orchestration/` with role-resolver and a minimal dispatcher (single task, no worktrees yet).
- Provider shims for Anthropic + OpenAI; tier→model maps populated.
- `packages/test-utils/` cassette infrastructure online.

**Gate**:
- Unit tests pass for core/, runtime/, orchestration/ in isolation (mocked Pi).
- An integration test dispatches a no-op Scout task against a cassette and gets back a `TaskResult`.
- Codex subprocess code is gone from the repo (`grep -r "codex exec"` returns nothing in `src/`).
- Token meter records correct input/output/cache numbers against the cassette.

**Risk**: Pi API surface mismatches our assumptions; the cassette infrastructure is harder than expected (cache_control bytes vary across replays).

### M2 — Single-agent path (target: 2 weeks)

**Goal**: End-to-end methodology flow runs on Pi for one provider, no worktrees, no parallel.

**Deliverables**:
- Lead/Dev runs through dispatcher in sequence (one Dev task at a time).
- QA runs with static-check ladder (verification_commands), escalating to LLM only on failures.
- Artefact pipeline writes/reads `.swt-planning/` identically to v2.x.
- Dashboard's existing panels work against the new event stream.

**Gate**:
- A reference greenfield project ("hello-world FastAPI service") can run a full milestone end-to-end on Anthropic, producing artefacts byte-identical (modulo timestamps) to a recorded v2.x golden run.
- Regression suite (see §12.4) passes.
- TPAC measured and recorded as the baseline for subsequent milestones.

**Risk**: Phase routing logic was tightly coupled to Codex subprocess return codes; expect refactoring pain.

### M3 — Worktree dispatcher (target: 3 weeks)

**Goal**: Subagent + worktree system online; parallel Dev tasks within a phase.

**Deliverables**:
- `worktree-manager.ts`, `claim-registry.ts`, `dag-resolver.ts`, `lock-files.ts` all implemented and tested.
- `report_result` tool wired; `shouldStopAfterTurn` integration confirmed.
- Crash recovery: kill -9 of a running orchestrator and successful resume.
- Dashboard worktree panel live.

**Gate**:
- A 3-task phase with declared `depends_on` runs as `[T01, T02 parallel], [T03 after both]`, with each task in its own worktree.
- Conflict prevention: an attempted edit outside a task's claim is rejected, logged, and retried with a corrective prompt.
- Crash test: SIGKILL the orchestrator mid-phase; restart; phase completes correctly.
- Wall-clock for the 3-task phase is at least 30% faster than sequential.

**Risk**: git worktree quirks on Windows; merge conflicts in tested scenarios.

### M4 — Token meter & cache discipline (target: 2 weeks)

**Goal**: Explicit context injection deployed; cache-hit ratio measured and high; TPAC -40% vs M2 baseline.

**Deliverables**:
- `buildPrompt()` deterministic context construction with cache-control breakpoints.
- Anthropic prompt-cache integration verified (≥70% hit rate on a 5-task phase).
- OpenAI prompt-cache verified.
- Budget Gate live: hard ceiling pauses milestone; pressure thresholds downgrade tiers.
- Dashboard cache-hit panel and budget gauge live.

**Gate**:
- TPAC measurement on the M2 reference project shows **−40%** vs M2 baseline.
- Cache hit ratio panel shows ≥70% on Anthropic runs of the reference project.
- Budget Gate test: configure a low ceiling; verify the milestone pauses and the dashboard reflects state.

**Risk**: Anthropic's `cache_control` requires a minimum token count per breakpoint; phases with small artefacts may not qualify. Mitigation: fallback to non-cached path with a warning.

### M5 — Multi-provider (target: 2 weeks)

**Goal**: Cross-vendor parallelism; provider fallbacks; provider router strategies.

**Deliverables**:
- OpenRouter shim (covers GLM, Kimi, DeepSeek, Llama, others).
- Optional Gemini shim (with hard warnings about ToS/OAuth risk).
- Provider router strategies (`pinned`, `round-robin`, `tier-routed`, `cost-optimized`).
- Fallback chain: primary fails → automatic failover with retry budget.
- Per-provider cost panel in dashboard.

**Gate**:
- A 3-task parallel batch runs with each task on a different provider; all complete successfully; result-protocol parses identically across providers.
- Simulate primary-provider outage (mock 503); fallback fires; milestone progresses.
- Per-provider cost panel shows correct attribution.

**Risk**: OpenRouter's response format varies per upstream model; structured output reliability differs widely.

### M6 — Decommission, benchmark, ship (target: 2 weeks)

**Goal**: v3.0 ships. Public benchmark published.

**Deliverables**:
- All Codex-era code paths removed.
- All stub CLI verbs deleted (no `EXIT.NOT_IMPLEMENTED`).
- Documentation fully rewritten for vendor-agnostic posture.
- Public benchmark scenario published (reference repo + scripts) showing TPAC −40% / cache hit ≥70% / cost −50% vs naive Codex CLI on equivalent work.
- Migration guide for v2.x users (one-shot script: `swt migrate --to=v3`).
- Release notes, CHANGELOG.

**Gate**:
- All v3.0 acceptance criteria from §1.2 met on the public benchmark.
- The migration script successfully upgrades a v2.x `.swt-planning/` to v3 schema without data loss on three test fixtures.
- All P0 dashboard panels green.
- All test suites pass: unit, integration, provider matrix, regression, e2e.

**Total estimated effort**: ~13 weeks of focused work. Plan for 16 with normal slippage.

---

## 12. Test Strategy

Test pyramid: many unit, fewer integration, fewer still e2e + provider-matrix. Discipline: every PR adds tests for the code it changes.

### 12.1 Unit tests (`packages/*/test/`)

**Framework**: Vitest (existing). Coverage target: **85% statements** for `core/` and `runtime/`; 75% elsewhere.

**Key suites**:

| Suite | What it covers |
|---|---|
| `core/phases/state-machine.test.ts` | Phase routing logic given disk state; exhaustive enumeration of state transitions |
| `core/artefacts/schema.test.ts` | Round-trip read/write of every artefact type; reject malformed inputs |
| `core/qa-tiers/ladder.test.ts` | Verification ladder execution order; fail-fast semantics |
| `runtime/cache-control.test.ts` | `buildPrompt()` produces byte-identical cached prefix across calls; tail differs only |
| `runtime/token-meter.test.ts` | Aggregation correctness; per-role, per-provider, per-milestone rollups |
| `runtime/providers/*.test.ts` | Per-provider shim: tier→model resolution, quirk normalization |
| `orchestration/dag-resolver.test.ts` | Topological sort correctness; cycle detection; batch identification |
| `orchestration/claim-registry.test.ts` | Atomic claim/release under simulated concurrency |
| `orchestration/dispatcher.test.ts` | Dispatcher orchestrates correctly given a mocked runtime |
| `orchestration/result-protocol.test.ts` | Schema validation; reject malformed subagent reports |
| `dashboard/server/sse-bridge.test.ts` | Pi event → SSE message mapping |

**Mocking strategy**: `test-utils/mocks/` exports `MockRuntime`, `MockProvider`, `MockSession`. Layer 2+ tests use these; no live LLM in unit tests, ever.

### 12.2 Integration tests (`packages/*/test/integration/`)

Real Pi `createAgentSession()` against an in-memory mock model + real tools + real filesystem (tempdir). Slow enough to gate with `pnpm test:integration`, fast enough to run in CI.

**Key suites**:

| Suite | Scenario |
|---|---|
| `runtime/session-lifecycle.int.test.ts` | Create session, dispatch turn, harvest result, dispose |
| `runtime/cache-hit.int.test.ts` | Two consecutive dispatches; assert second's input tokens reflect cache hit (against Anthropic-shaped mock) |
| `orchestration/worktree-roundtrip.int.test.ts` | Create worktree → dispatch → merge → cleanup, full cycle |
| `orchestration/parallel-batch.int.test.ts` | 3 tasks in parallel, each in its own worktree, all complete, results harvested correctly |
| `orchestration/crash-recovery.int.test.ts` | Spawn dispatcher subprocess, kill -9 mid-task, recover, complete |
| `dashboard/sse-flow.int.test.ts` | Real Hono server + real SSE; emit events from a fake session; assert client receives them in order |

### 12.3 Provider matrix tests (`test/provider-matrix/`)

Real LLM calls. Gated behind `RUN_PROVIDER_TESTS=1` and API key env vars. Run nightly in CI with rotated keys; not on every PR.

For each provider (Anthropic, OpenAI, OpenRouter+GLM, OpenRouter+Kimi, Gemini if keys available):

| Test | What it asserts |
|---|---|
| `tier-resolution.test.ts` | Each capability tier resolves to a real model id that returns 200 on a probe call |
| `structured-output.test.ts` | `report_result` tool schema is honored; resulting JSON matches `TaskResultSchema` |
| `cache-behavior.test.ts` | Cache control / prompt prefix caching produces measurable cache hits across 3 consecutive calls (provider-specific assertion thresholds) |
| `tool-call-fidelity.test.ts` | `bash`, `read`, `write`, `edit` all execute correctly with this provider |
| `streaming-events.test.ts` | Pi's event stream is well-formed; no malformed deltas |
| `rate-limit-handling.test.ts` | Trigger a 429 (or simulate); verify backoff and retry |

Each test has a per-provider tolerance (e.g., cache hit ratio assertion is `≥0.5` for OpenAI, `≥0.7` for Anthropic).

### 12.4 Regression suite (`test/regression/`)

**Cassette pattern**: record real LLM responses once, replay forever. Cassettes live in `test-utils/cassettes/<scenario>/<turn-N>.json`.

The cassette format captures:
- The request (messages, tools, model, params)
- The response (messages, usage, finish reason)
- Timing metadata

`MockProvider` reads cassettes and returns them deterministically. To re-record (e.g., after a system prompt change): `pnpm test:regression --record`.

**Golden artefact pattern**: for each milestone scenario, the expected `.swt-planning/` state after the run is stored in `test-utils/golden/<scenario>/`. The regression test diffs the produced state against the golden state, with allowlisted ignores (timestamps, random IDs).

**Key scenarios**:

| Scenario | Description |
|---|---|
| `greenfield-fastapi` | Bootstrap a new FastAPI project, run M1 → archive |
| `brownfield-typescript` | Map an existing TS repo, plan a feature, execute, verify |
| `qa-fail-then-fix` | Dev produces code; QA fails; Debugger diagnoses; Fix lands; QA passes |
| `parallel-3-tasks` | A phase with 3 independent tasks runs in parallel worktrees |
| `crash-mid-task` | Kill mid-task; recover; complete |
| `budget-ceiling-hit` | Configure low ceiling; milestone pauses correctly |

### 12.5 Token-cost benchmark (`test/benchmark/`)

The **proof** of "stop wasting tokens". Run weekly in CI; result published to a public dashboard.

**Setup**:
- Reference repos: 3 of them, varying size (small TS lib, medium FastAPI service, large Next.js app).
- Reference milestones: 1 per repo, scripted with predefined PROJECT.md + REQUIREMENTS.md.

**Measurements** (averaged across providers per run, plus per-provider breakdowns):
- Total input tokens
- Total output tokens
- Total cache-read tokens
- Cache-hit ratio
- Wall-clock time
- Cost (USD)
- TPAC (tokens per shipped acceptance criterion)
- TPAC delta vs baseline

**Baseline**: the M2-recorded run on the same scenario. Persisted as a fixed reference; not changed lightly. Re-baselining requires a PR with rationale.

**Gate**: M4 onward, every PR must NOT regress TPAC by >5% on any scenario. CI enforces.

### 12.6 E2E scenarios (`test/e2e/`)

Real CLI invocation. Spawn `swt` as a subprocess. Real filesystem. Mocked LLM (cassette-backed). Assert exit codes, stdout patterns, artefact deltas.

| Scenario | Command sequence |
|---|---|
| `init-greenfield.e2e.test.ts` | `swt init` → assert artefacts created |
| `vibe-auto-route.e2e.test.ts` | `swt vibe` in various states → assert correct routing |
| `headless-ci.e2e.test.ts` | `swt headless next --timeout 60000` → exit code 0 on success, 2 on blocked |
| `dashboard-boot.e2e.test.ts` | `swt dashboard` → HTTP probe; cmd-K palette responds |
| `migrate-v2-to-v3.e2e.test.ts` | Run migration script on a v2 fixture; assert v3 artefacts produced |

### 12.7 Property-based tests (`test/property/`)

Using `fast-check`. Sparingly — only for components with combinatorial state spaces.

- DAG resolver: random task graphs → no batch contains intra-batch dependencies.
- Claim registry: random concurrent claim/release sequences → no double-claim.
- Cache-control insertion: arbitrary message lists → resulting structure is always cache-valid (breakpoints in correct positions).

### 12.8 Test execution matrix

| Suite | Runs on | Frequency | Time budget |
|---|---|---|---|
| Unit | Every PR | Always | <30s |
| Integration | Every PR | Always | <2min |
| Regression (cassette + golden) | Every PR | Always | <3min |
| E2E | Every PR | Always | <5min |
| Property-based | Every PR | Always | <1min |
| Provider matrix | Nightly | Daily | <15min |
| Token benchmark | Weekly + on perf PRs | Weekly | <30min |

CI config: PR pipeline runs first five (max ~12min). Nightly runs full matrix.

### 12.9 Test conventions

- **One assertion per concept.** Don't fold 5 distinct checks into one `expect()`.
- **Arrange / Act / Assert** with blank lines between.
- **Name tests by behavior, not by function.** `it("rejects a dispatch when budget ceiling is exceeded")` not `it("dispatch throws")`.
- **Never assert on prose returned by an LLM** in regression tests. Always assert on the structured `TaskResultSchema` output.
- **Tempdirs auto-cleanup**. Use `vitest`'s `afterEach(rm tempdir)` pattern; failed tests preserve dirs only when `KEEP_TEST_DIRS=1`.

---

## 13. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Pi API changes during the 13-week project | High | Pin Pi minor version; weekly upstream-sync check; carry a patch if needed; integration tests catch breakage early |
| Anthropic OAuth ToS hostility escalates | Medium | API key path is first-class; OAuth path is opt-in with warning; if OAuth gets disabled, only OAuth-only users break, and they were already on shaky ground |
| Prompt cache portability varies across providers more than expected | High | Per-provider cache test suite in §12.3; fallback to uncached path with warning when caching unavailable; document the per-provider hit-rate floor |
| Disk overhead from parallel worktrees on monorepos | Medium | Configurable `max_parallel_worktrees`; shared `node_modules` cache via symlink (P1); document the disk-usage profile |
| Subagent structured-output reliability varies by provider | High | `report_result` tool is the protocol; if a provider can't honor it consistently, that provider drops out of the multi-provider matrix. We don't fight bad structured-output support; we route around it |
| Merge conflicts in parallel worktrees | Medium | Declared file claims prevent overlap; DAG enforces ordering; if conflict happens anyway, escalate to user via dashboard |
| Test infrastructure (cassettes) become stale | Medium | Cassettes are re-recorded each time a system prompt or model changes; CI flags cassette age >90 days; explicit re-record command |
| "Better Codex CLI" identity crisis (we accidentally become a generic coding agent) | High | TDD principle §2.1 + §2.4; every PR description must state which methodology principle it serves; quarterly architecture review |
| Token-saving claim is provable on benchmark but not in real-world use | Medium | Benchmark scenarios are realistic (real repos, real milestones); publish methodology so users can reproduce on their own repos; collect opt-in anonymous TPAC metrics from real users (P2) |
| Crash recovery has gaps we haven't found | High | Chaos test suite (P1): random SIGKILLs at various lifecycle points; assert recovery in all cases |
| Migration from v2.x corrupts user data | High | Migration script runs against three test fixtures in CI; refuses to run if `.swt-planning/` is dirty; always copies to `.swt-planning.v2-backup/` before transforming |

---

## 14. Decision Log Stub

ADRs live in `docs/decisions/ADR-NNN-title.md`. Required ADRs (write these in M1):

- ADR-001: Why Pi SDK and not LangChain / custom / fork-of-Codex
- ADR-002: Why capability tiers over reasoning-effort levels
- ADR-003: Worktree-per-task vs worktree-per-milestone (we chose per-task)
- ADR-004: Why deletion of stub commands instead of incremental implementation
- ADR-005: Why `report_result` tool over emitting final text
- ADR-006: Why deterministic context construction over Pi's compaction

ADRs are short (≤2 pages), formatted: Context / Decision / Consequences / Alternatives considered.

---

## 15. Open Questions

These need resolution during M1 (record as ADRs):

1. **Real-time cache-hit measurement**: Does every target provider expose cache-read tokens in response metadata? Anthropic yes (`cache_read_input_tokens`). OpenAI yes (in usage). Gemini ? OpenRouter passes-through depending on upstream. **Action**: write `runtime/providers/*/usage-extraction.test.ts` in M1 to enumerate.
2. **Max parallel worktrees**: Reasonable default? GSD-2 doesn't impose a hard cap. **Action**: pick a default (`4`?) and document trade-offs in config.
3. **MCP server isolation**: Per-worktree MCP processes (heavyweight), or shared pool (lighter, possible context cross-contamination)? **Action**: prototype both in M3; pick before M4.
4. **Skill discovery scope**: SWT today uses skills; how do they interact with subagents in worktrees? Per-worktree discovery (correct but slow) or inherited from parent (fast but possibly wrong)? **Action**: ADR-007 in M3.
5. **`pi-share-hf` integration for benchmark publishing**: Pi has a mechanism for publishing session data publicly. Should our benchmark scenarios use this? Could become the public proof artifact. **Action**: investigate during M4; decide before M6.

---

## 16. Appendices

### Appendix A: Code sketches

#### A.1 Dispatcher entry point

```typescript
// packages/orchestration/src/dispatcher.ts
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  createCodingTools,
  DefaultResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { resolveModel } from "./role-resolver";
import { createReportResultTool } from "./result-protocol";
import { attachTokenMeter } from "../runtime/token-meter";
import { BudgetGate } from "../runtime/budget-gate";
import { ClaimRegistry } from "./claim-registry";
import { WorktreeManager } from "./worktree-manager";

export interface DispatchOptions {
  task: Task;
  role: Role;
  milestoneCtx: MilestoneContext;
  phaseCtx: PhaseContext;
  budget: BudgetGate;
  claims: ClaimRegistry;
  worktrees: WorktreeManager;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}

export async function dispatch(opts: DispatchOptions): Promise<TaskResult> {
  const { task, role } = opts;

  // 1. Reserve a worktree
  const worktree = await opts.worktrees.create(task);

  // 2. Claim files
  const claimResult = await opts.claims.claim(task.id, task.declaredFiles, worktree.path, process.pid);
  if (!claimResult.ok) {
    await opts.worktrees.discard(worktree);
    throw new ClaimConflictError(claimResult.conflicts);
  }

  // 3. Resolve model
  const { model, thinkingLevel } = resolveModel(role, opts.modelRegistry, /* config */);

  // 4. Build resource loader with the cached prefix
  const loader = new DefaultResourceLoader({
    cwd: worktree.path,
    systemPromptOverride: () => buildSystemPromptFor(role, opts.milestoneCtx, opts.phaseCtx),
  });
  await loader.reload();

  // 5. Create session with cwd-scoped tools + report_result
  const reportResultTool = createReportResultTool(task.id);
  const { session } = await createAgentSession({
    cwd: worktree.path,
    model,
    thinkingLevel,
    tools: createCodingTools(worktree.path),
    customTools: [reportResultTool],
    sessionManager: SessionManager.inMemory(),
    authStorage: opts.authStorage,
    modelRegistry: opts.modelRegistry,
    resourceLoader: loader,
    // Inject the shouldStopAfterTurn hook: stop when report_result fired
    shouldStopAfterTurn: (ctx) => ctx.metadata.has("task_result"),
  });

  // 6. Attach meter and budget gate
  const meter = attachTokenMeter(session, { taskId: task.id, role });
  opts.budget.attach(session, meter);

  // 7. Run
  await session.prompt(buildTaskPrompt(task));

  // 8. Harvest
  const result = meter.snapshot();
  const taskResult = session.agent.state.metadata.get("task_result") as TaskResultPayload;
  if (!taskResult) {
    throw new Error(`Task ${task.id} terminated without report_result`);
  }

  // 9. Merge or discard
  const diff = await opts.worktrees.diff(worktree);
  if (taskResult.status === "success" && diff) {
    await opts.worktrees.mergeSquash(worktree, task);
  } else {
    await opts.worktrees.discard(worktree);
  }

  // 10. Cleanup
  await opts.claims.release(task.id);
  await opts.worktrees.remove(worktree);
  session.dispose();

  return { ...taskResult, cost: result, worktree: worktree.path };
}
```

#### A.2 Cache-control prompt builder (Anthropic-shaped)

```typescript
// packages/runtime/src/cache-control.ts
import type { Message } from "@mariozechner/pi-ai";

export function buildPrompt(
  role: Role,
  systemPrompt: string,
  milestoneCtx: MilestoneContext,
  phaseCtx: PhaseContext,
  taskPrompt: string,
): Message[] {
  // Each "block" is set up so the runtime adapter can inject cache_control
  // breakpoints at the boundaries. Provider shim does the actual injection
  // (Anthropic) or relies on provider behavior (OpenAI prefix-caching).

  return [
    { role: "system", content: systemPrompt, _cacheBoundary: true },
    {
      role: "user",
      content: [
        { type: "text", text: `# PROJECT\n${milestoneCtx.project}`, _cacheBoundary: true },
        { type: "text", text: `# REQUIREMENTS\n${milestoneCtx.requirements}`, _cacheBoundary: true },
        { type: "text", text: `# MILESTONE\n${milestoneCtx.milestone}`, _cacheBoundary: true },
        { type: "text", text: `# PHASE\n${phaseCtx.plan}`, _cacheBoundary: true },
        { type: "text", text: `# TASK\n${taskPrompt}` },  // no boundary; this varies
      ],
    },
  ];
}
```

The `_cacheBoundary` flag is consumed by the Anthropic provider shim, which translates it to `cache_control: { type: "ephemeral" }` on the matching content block. OpenAI provider shim ignores the flag — prefix caching is automatic if the prefix is sufficiently long.

#### A.3 Result protocol tool

```typescript
// packages/orchestration/src/result-protocol.ts
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export const TaskResultSchema = Type.Object({
  status: Type.Union([
    Type.Literal("success"),
    Type.Literal("partial"),
    Type.Literal("blocked"),
    Type.Literal("failed"),
  ]),
  summary: Type.String({ maxLength: 2000 }),
  must_haves: Type.Array(
    Type.Object({
      id: Type.String(),
      description: Type.String(),
      verified: Type.Boolean(),
      evidence: Type.Optional(Type.String()),
    }),
  ),
  files_touched: Type.Array(Type.String()),
  decisions_made: Type.Optional(Type.Array(Type.String())),
  blocked_by: Type.Optional(Type.String()),
  follow_ups: Type.Optional(Type.Array(Type.String())),
});

export type TaskResultPayload = Static<typeof TaskResultSchema>;

export function createReportResultTool(taskId: string): ToolDefinition {
  return {
    name: "report_result",
    label: "Report task result",
    description:
      "Call this EXACTLY ONCE when the task is complete or blocked. After this call, " +
      "your turn ends and the orchestrator harvests your result. Do not emit prose after this call.",
    parameters: TaskResultSchema,
    execute: async (toolCallId, params, _onUpdate, ctx) => {
      ctx.metadata.set("task_result", params);
      return {
        content: [{ type: "text", text: `Result recorded for ${taskId}. Task complete.` }],
        details: { task_id: taskId, status: params.status },
      };
    },
  };
}
```

#### A.4 Claim registry (atomic)

```typescript
// packages/orchestration/src/claim-registry.ts
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { acquireLock, releaseLock } from "../shared/file-lock";

export interface Claim {
  worktree: string;
  pid: number;
  files: string[];
  started_at: string;
}

export class ClaimRegistry {
  constructor(private dir: string) {}

  private path() {
    return join(this.dir, "claims.json");
  }

  async claim(
    taskId: string,
    files: string[],
    worktree: string,
    pid: number,
  ): Promise<{ ok: true } | { ok: false; conflicts: string[] }> {
    const lock = await acquireLock(this.path() + ".lock");
    try {
      const current = await this.read();
      const conflicts: string[] = [];
      for (const [otherId, claim] of Object.entries(current.active)) {
        if (otherId === taskId) continue;
        const overlap = claim.files.filter((f) => files.includes(f));
        if (overlap.length > 0) conflicts.push(otherId);
      }
      if (conflicts.length > 0) return { ok: false, conflicts };

      current.active[taskId] = {
        worktree,
        pid,
        files,
        started_at: new Date().toISOString(),
      };
      await this.write(current);
      return { ok: true };
    } finally {
      await releaseLock(lock);
    }
  }

  async release(taskId: string): Promise<void> {
    const lock = await acquireLock(this.path() + ".lock");
    try {
      const current = await this.read();
      delete current.active[taskId];
      await this.write(current);
    } finally {
      await releaseLock(lock);
    }
  }

  async conflicts(files: string[]): Promise<string[]> {
    const current = await this.read();
    return Object.entries(current.active)
      .filter(([, claim]) => claim.files.some((f) => files.includes(f)))
      .map(([id]) => id);
  }

  private async read(): Promise<{ version: number; active: Record<string, Claim> }> {
    try {
      const raw = await fs.readFile(this.path(), "utf8");
      return JSON.parse(raw);
    } catch (e: any) {
      if (e.code === "ENOENT") return { version: 1, active: {} };
      throw e;
    }
  }

  private async write(data: { version: number; active: Record<string, Claim> }) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.path(), JSON.stringify(data, null, 2));
  }
}
```

### Appendix B: Vendor Capability Matrix

| Capability | Anthropic | OpenAI/Codex | Gemini | OpenRouter (passthrough) | Notes |
|---|---|---|---|---|---|
| Prompt caching | Explicit `cache_control` blocks | Automatic prefix cache (5min TTL) | Context caching API (manual) | Depends on upstream model | Anthropic offers the deepest savings (~90% off cached input); plan our cache strategy around Anthropic and verify others |
| Structured output | Tool-use (JSON schema) | `response_format: { type: "json_schema", strict: true }` | Function calling | Varies | All workable for `report_result`; strict mode varies in reliability |
| Tool calling | Native | Native | Native | Varies | Pi normalizes |
| Streaming | SSE | SSE | SSE | SSE | All compatible |
| OAuth (subscription auth) | Claude Max (ToS-risky) | ChatGPT Plus / Codex (more retail-friendly) | Account-suspension risk — AVOID | N/A | Default to API keys; OAuth opt-in with warnings |
| Token reporting in response | `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens` | `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens` | `usageMetadata.promptTokenCount`, `cachedContentTokenCount` | Varies | Token meter normalizes |
| Rate-limit error shape | 429 with `retry-after` | 429 with `retry-after` | 429 with `Retry-After` | Varies | All compatible with Pi's auto-retry |
| Thinking levels | Supported (`thinking.type=enabled, budget_tokens`) | o-series only | Limited (no fine-grained levels) | Varies | Use Pi's `thinkingLevel` abstraction |
| Max context | 200k typical | 200k typical | 1M+ on some models | Varies | Methodology assumes 200k; don't depend on more |

### Appendix C: Glossary

- **Acceptance criterion**: A must-have on a task or slice. The atomic unit of "shipped" work.
- **Artefact**: A file under `.swt-planning/` that is the source of truth for some piece of project state.
- **Cassette**: A recorded LLM request/response pair used for deterministic test replay.
- **Claim**: A declared intent to modify a specific file by a specific task. Prevents conflicts in parallel dispatch.
- **DAG**: Directed acyclic graph of task dependencies; computed from `depends_on` and implicit file overlap.
- **Dispatcher**: The Layer 2 component that spawns subagents, harvests results, manages worktrees.
- **Golden artefact**: A reference output of `.swt-planning/` state used as the expected value in regression tests.
- **Must-have**: A mechanically verifiable outcome on a task plan. The atomic unit of "what we built".
- **Phase**: A coherent unit of work within a milestone; produces one or more tasks.
- **Provider shim**: A small module that normalizes a specific LLM provider's quirks to the runtime adapter's internal contract.
- **Role**: One of the six (Scout, Architect, Lead, Dev, QA, Debugger). A role maps to a system prompt, a capability tier, and a session strategy.
- **Slice**: A demoable vertical capability within a milestone; decomposes into tasks.
- **Subagent**: A process running in a worktree, internally consulting an LLM via Pi.
- **Tier**: One of (cheap-fast, balanced, quality, reasoning). Capability classification independent of model.
- **TPAC**: Tokens Per Acceptance Criterion. The north-star metric.
- **Worktree**: A `git worktree` checkout used to isolate a subagent's filesystem view.

---

## End of TDD

This document is the contract. Code that conflicts with it loses; if reality demands the contract change, amend the document first, then the code.

Outstanding ADRs to be written in M1 are listed in §14. Open questions to resolve before M2 are in §15.

The first PR should be: extract `packages/core/` from current SWT, with all Codex-specific code removed, and a passing unit test suite. That's the smallest credible step toward M1.

Go build.
