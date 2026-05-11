# TDD2: SWT v3 — Pi-Native, Vendor-Agnostic, Worktree-Isolated Coding Harness

> **Document type:** Technical Design Document & Implementation Blueprint (v2)
> **Status:** Draft v0.1 — Supersedes `TDD.md`. Authoritative for the v3 milestone once approved.
> **Audience:** Lead developer executing the rewrite; reviewers approving milestones; CI/CD owner.
> **Last updated:** 2026-05-11
> **Supersedes:** `TDD.md` (Draft v1.0, 2026-05-11). Differences logged in §1.6.

---

## 0. How to use this document

### 0.1 Purpose

This is the **master plan** for rewriting `stop-wasting-tokens` (SWT) on top of the Pi SDK, in place on `main`. It is **prescriptive** where decisions have been made, **directive** about test gates, and **explicit** about what to delete.

TDD2 replaces the earlier `TDD.md` because that document was drafted against an unverified Pi SDK surface and contained material errors (wrong package namespace, references to non-existent APIs, a caching architecture that doesn't map onto Pi's actual feature set). The errors are not philosophical — they would have shipped broken code. TDD2 is grounded in `pi.dev/docs/latest` as of 2026-05-11 and in the actual v2.3.5 source cloned from `github.com/swt-labs/stop-wasting-tokens`.

### 0.2 Conventions

The conventions inherited from TDD.md, retained verbatim:

- **MUST / SHOULD / MAY** follow RFC 2119 strictness.
- **P0** = required for v3.0 ship. **P1** = required within one minor release. **P2** = nice-to-have, defer.
- Code sketches are illustrative TypeScript using Pi's actual SDK names. They compile in spirit, not necessarily on first paste — treat them as the shape of what the file should look like.
- Where you encounter ambiguity not resolved here, record the decision in `docs/decisions/ADR-NNN.md` and reference it in the matching PR.

The conventions added in TDD2:

- **VERIFIED** vs **ASSUMED** vs **OPEN** prefixes are used in §5 (Pi SDK Integration Reference) to mark each fact's grounding.
- **§ references** without a prefix point to this document.
- **TDD.md§N.M** references point to the older document for delta context.
- Every code snippet that names a Pi SDK symbol MUST be verifiable against `pi.dev/docs/latest`. If a symbol is not verifiable, it is wrapped in `⟦…⟧` with a footnote.

### 0.3 Living document status

The document is **living**. Material deviations need a PR amending the TDD before code; minor scoping decisions go in ADRs.

When you find a contradiction between TDD2 and the actual Pi SDK behavior, the SDK wins — and TDD2 must be updated in the same PR that handles the divergence. Do not silently work around it.

### 0.4 Reading order

If you are:

- **Implementing M1**: read §0 → §1 → §2 → §3 → §4 → §5 → §6 → §11 → §13.1 → §14.1-14.3
- **Implementing M2**: read §5 → §7 → §10 → §11 → §13.2 → §14
- **Implementing M3**: read §9 → §13.3 → §14.10
- **Implementing M4**: read §8 → §13.4 → §14.9
- **Implementing M5**: read §7 → §13.5
- **Implementing M6**: read §13.6 → §17 → §18
- **Reviewing CI/CD changes**: read §15
- **Reviewing release**: read §17

### 0.5 Out of scope for this document

- Replacement of `.swt-planning/` filesystem schema. v3 is **schema-stable** for `.swt-planning/`, with one additive change (`schema_version` field at the top of `config.json`) — see §11.3.
- New language support for the methodology beyond Pi's existing model list. v3 expands provider coverage, not domain coverage.
- A hosted/cloud dashboard. v3 remains localhost-only, same as v2.x.
- Anything in `a_non_production_files/` (sandbox area in v2 root).

---

## 1. Executive Summary

### 1.1 Goal

Rebuild SWT as a **vendor-agnostic, Pi-native coding harness** that ships measurably fewer tokens per acceptance criterion than naive Codex CLI / Claude Code / equivalent harnesses on the same workload — while preserving SWT's methodology (six-agent SDLC, planning artefacts, goal-backward QA).

The change is **subtractive at the runtime layer** (delete the three driver packages, delete `.codex-plugin/`, dismantle the 21 `EXIT.NOT_IMPLEMENTED` stub verbs per the §3.2.4 disposition table — most become real verbs, a few fold into `vibe`, two drop) and **additive at the orchestration layer** (worktree dispatcher, DAG resolver, claim registry, token meter, budget gate, multi-provider router). The methodology layer is **preserved verbatim** with two architectural fixes: the `methodology → codex-driver` and `cli → {codex,claude-code,ollama}-driver` edges (vibe.ts imports all three driver packages) visible in v2.3.5's source are broken on day one (§11.5).

### 1.2 North-star metrics

**Tokens per shipped acceptance criterion (TPAC)** is the single number that decides whether v3 shipped or just refactored.

| Metric | Baseline (v2.3.5 + Codex CLI) | v3.0 ship target | v3.x stretch |
|---|---|---|---|
| TPAC (input + output combined) | TBD — measured during M1 against the reference repo | **−40%** | **−60%** |
| Cache hit ratio (Anthropic provider) | 0% (not instrumented in v2) | **≥70%** on the M2 reference project | ≥80% |
| Wall-clock per phase | v2.3.5 sequential baseline | parity | −20% via parallelism (M3+) |
| Cost per acceptance criterion (USD) | baseline measured M1 | **−50%** | −70% |
| Restart-from-kill-9 success rate | n/a (v2.x has no resumability story) | 100% on the chaos test suite | 100% |
| Provider failover MTTR | n/a | <30s with retry budget | <10s |

These numbers are **not aspirational marketing**. They are **acceptance criteria for v3.0**. If we cannot demonstrate them on a public benchmark by M6 close, v3.0 does not ship — we cut to v3.0-rc and iterate until the benchmark passes.

The "TBD — measured during M1" cells become **fixed numbers** at the M1 gate. After M1, no metric in this table is allowed to regress without a documented ADR and a PR specifically gating the regression.

### 1.3 Scope

**In scope for v3.0:**

- Full rewrite of the runtime layer to use `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`.
- Vendor-agnostic provider/role abstraction (Anthropic, OpenAI/Codex, OpenRouter, Gemini, GLM, Kimi, local via Ollama/vLLM/LM Studio).
- Git-worktree-isolated subagent dispatch with declared file claims and DAG-based parallel execution.
- Token-meter instrumentation surfaced to the dashboard.
- Preservation of the methodology layer (`.swt-planning/` artefacts, phase lifecycle, six roles, must-haves, QA tiers).
- Migration of the existing Hono + Solid + SSE dashboard to consume Pi events.
- Migration script for v2.x users: `swt migrate --to=v3`.
- Public reproducibility benchmark (reference repo + scripts) demonstrating the TPAC/cache/cost targets.
- Full CI/CD pipeline parity with v2.3.5 plus a provider-matrix workflow.
- ADR repository in `docs/decisions/` with at least 12 ADRs seeded at M1 close.

**Out of scope for v3.0:**

- Claude Code or Codex CLI as a "backend". They are deleted, not coexisting. Migration assistance is provided via `swt migrate --to=v3`; once migrated, no co-existence mode exists.
- Hosted/cloud dashboard. Localhost only, same as v2.x.
- Team coordination features beyond what GSD-2 has demonstrated (`.swt-planning/parallel/` IPC). Multi-machine federation is v4 work.
- Mobile/IDE-plugin UIs beyond what the current TUI/dashboard provide.
- Replacing the methodology layer. The six-role split, phase lifecycle, and artefact schemas are stable.
- Replacing the `.swt-planning/` filesystem schema (additive `schema_version` only).
- AGENTS.md replacement; SWT v3 continues to consume the user's `AGENTS.md` exactly as Pi consumes it natively. No fork.

### 1.4 Non-goals

We are **not** building "a better Codex CLI". We are building a methodology layer that happens to run on a vendor-agnostic agent runtime. The methodology — not the agent — is the product. If the project ever resembles a generic coding agent, the design has drifted.

We are **not** building a Pi extension that adds methodology to Pi. Pi extensions are a controlled lateral channel inside SWT, but the SWT binary owns the lifecycle; Pi is a library inside SWT, not the other way around.

We are **not** entering the LLM evaluation business. We measure tokens, cache hits, and cost. We do not score output quality beyond methodology-defined must-haves and verification gates.

### 1.5 Strategy summary

1. **Delete the Codex subprocess path entirely.** It is a workaround for not owning the runtime; v3 owns the runtime. The three driver packages (`codex-driver`, `claude-code-driver`, `ollama-driver`) and the `.codex-plugin/` directory go away in M1.

2. **Adopt Pi's `createAgentSession()` and `createAgentSessionRuntime()` as the runtime primitives.** No reinvention. The `runtime/` layer is a *thin* adapter: < 50 lines per file is the rule; anything bigger is leaking methodology into the adapter.

3. **Treat subagents as processes-in-worktrees**, not as LLM features. Worktrees give us isolation; Pi gives us per-session model selection (`setModel()`) and ephemeral mode (`--no-session` or in-memory `SessionManager`); together they give us parallel + multi-provider as a first-class capability.

4. **Build the meter first.** Token instrumentation lands before any optimization claim is made. We measure before we tune. M1 ships an integration test asserting cassette-replayed token counts equal the meter's reported counts to within 1 token.

5. **Methodology is provider-agnostic from day one.** Role profiles describe *capability tiers* (cheap-fast, balanced, quality, reasoning), not specific models. Tier→model resolution happens at the runtime layer. Breaking the `methodology → codex-driver` edge in v2.3.5 is the entry gate for M1, not its exit.

6. **Provider quirks live where they belong.** Pi already supports 25+ providers natively. SWT v3 does NOT write provider shims at M1; it writes a role-resolver that consumes Pi's existing provider list and an overrides file (`runtime/providers/quirks.json`) for the small handful of cases where Pi's defaults are wrong for our workload (e.g., `thinkingLevelMap` tuning for Anthropic Opus, or `compat.maxTokensField` for older GPT models).

7. **Provider-level caching, not Pi-level caching.** Pi's compaction is conversation summarization. Anthropic's `cache_control` and OpenAI's prompt caching are *provider-shim* concerns and live in the `runtime/cache/` module configured through `ProviderModelConfig.cost.{cacheRead,cacheWrite}`. The "≥70% cache hit ratio" target is achieved by deterministic prompt prefix + stable message ordering + cache-control breakpoint placement, all sitting under the runtime adapter — not by anything Pi exposes at the session level.

8. **The dashboard is the primary UX.** v2.x set this direction; v3 doubles down. The CLI exists for headless / CI / power-user fallback. New features land in the dashboard first, with CLI parity following (matching the v2.3.x cadence).

9. **Crash-safety is non-negotiable.** Any operation that creates a worktree, an LLM session, or a long-running process MUST be resumable from disk state after `kill -9`. Lock files + PID liveness + structured journals everywhere. The M3 chaos test gates this.

10. **Compose, don't fork.** When Pi gains a feature, we use it. When Pi has a bug, we file an issue and possibly carry a patch — we don't fork the SDK. The `runtime/` adapter is the only place patches land; nothing under `core/` is allowed to import `@earendil-works/*` directly.

### 1.6 Correction log vs TDD.md

The following claims in `TDD.md` were verified incorrect or unsupported during recon (see `.vbw-planning/research/recon.md` for sources):

| TDD.md location | TDD.md claim | Correction in TDD2 | Severity |
|---|---|---|---|
| TDD.md§1.3 In Scope | "Pi SDK packages: `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`" | **Real namespace:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`. Global rename. | **BLOCKING** |
| TDD.md§3.1 | "Methodology engine is PRESERVED" (implicitly: clean to lift) | v2.3.5's `@swt-labs/methodology/package.json` declares `@swt-labs/codex-driver` as a runtime dependency. The methodology→codex edge MUST be broken before any Pi work. New: explicit M1 entry gate condition. | **HIGH** |
| TDD.md§4.1 Layer 1 | "thin interface over Pi" | Verified — but TDD.md elides the **Extension API**. Pi's Extension model adds horizontal hooks that SWT must use rather than reinvent (`pi.registerProvider`, `pi.registerTool`, `pi.on(event, handler)`). New §5.4 documents Extension vs raw-SDK boundary. | **MEDIUM** |
| TDD.md§7 Token Optimization | "Cache-control insertion at Layer 1" (treated as Pi feature) | Pi has no native `cache_control` API. Provider-level caching lives in the provider shim, configured via `ProviderModelConfig.cost.cacheRead/cacheWrite` and the `api: "anthropic-messages"` type. §8 fully rewrites this. | **HIGH** |
| TDD.md§8 / §11 M3 Gate | "`shouldStopAfterTurn` integration confirmed" | No such API in Pi docs. The equivalent is the Extension hook `agent_end` plus the per-tool return `{terminate: true}`. §9.4 rewrites the result protocol. | **HIGH** |
| TDD.md§11 M3 Deliverables | "`report_result` tool wired" | No such built-in tool. Implement as custom tool via `pi.registerTool` and persist via the closure-captured `pi.appendEntry` (NOT `ctx.appendEntry` — `appendEntry` lives on `ExtensionAPI`, not `ExtensionContext`; see §5.4 boundary note). §9.4 covers the schema. | **MEDIUM** |
| TDD.md§11 M1 Deliverables | "Provider shims for Anthropic + OpenAI" | Pi already supports both natively. M1 ships a **role-resolver** plus a *quirks* override file; it does NOT ship provider shims. Reframed in §13.1. | **MEDIUM** |
| TDD.md§12.4 | "Vitest test suite preserved as regression baseline" | Only 2 root-level test files in v2.3.5; bulk of tests live in `packages/*/test/`. Phase B-2 inline reads will produce the full inventory in §14.6. | **LOW** (no design impact, but the test-coverage claim was loose) |
| TDD.md§5.2 | "Single CLI entrypoint: `packages/cli/bin/swt.mjs`" | v2.3.5 bins to `./dist/cli.mjs` from the root `package.json`, not from `packages/cli/bin/`. v3 keeps the v2 binary location to preserve `npx swt` muscle memory. §6.5. | **LOW** |
| TDD.md§4 Layer 0 | "Pi SDK (external dependency)" without specifying peer-dependency policy | Pi's docs recommend listing core packages as `"peerDependencies": "*"` (not bundling). SWT v3 follows. §6.4. | **LOW** |

All other content in TDD.md is preserved or refined; nothing else was found materially incorrect.

The correction log is **not** an exhaustive diff. Section-level deltas are called out at the head of each TDD2 section as `> **Δ from TDD.md§N:** …` blocks where relevant.

---

## 2. Architectural Principles (Constitution)

These principles are **load-bearing**. Any design decision that violates them needs an ADR justifying the exception, signed off in a PR. Reviewers MUST cite these principle numbers in review comments when objecting to a design.

### Principle 1 — The methodology layer is the IP

Anything in `.swt-planning/` is sacred. Artefact schemas, phase lifecycle, six-role split, must-haves, goal-backward QA — preserved. Code that touches these MUST be vendor-agnostic.

**Test of compliance:** `grep -r '@earendil-works\|anthropic\|openai\|codex' packages/core/` returns nothing. The `core/` package has no provider, no LLM, no Pi knowledge.

**Why:** SWT's value is the methodology, not the substrate. If a future Pi successor appears, switching substrate must be a runtime-layer rewrite, not a methodology rewrite.

### Principle 2 — The runtime layer is replaceable

Today: Pi. Tomorrow: maybe something else. Code that calls Pi APIs lives behind a thin internal interface (`packages/runtime/src/`) so a future swap is mechanical, not architectural.

**Test of compliance:** `grep -r '@earendil-works' packages/ --include='*.ts' | grep -v '^packages/runtime/'` returns nothing.

**Why:** Pi is pre-1.0. APIs will change. By concentrating dependencies, we localize churn.

### Principle 3 — The provider is a parameter, not a backbone

No file in the repo SHOULD have "anthropic" or "openai" or "codex" in its name outside of `packages/runtime/src/providers/`. Provider-specific quirks are normalized at the boundary.

**Test of compliance:** `find packages -name '*anthropic*' -o -name '*openai*' -o -name '*codex*' | grep -v packages/runtime/` returns nothing.

**Why:** A methodology that depends on a vendor is a methodology that breaks when the vendor breaks. We've experienced this in v2 (the `codex-driver` edge into methodology); v3 prevents it structurally.

### Principle 4 — Subagents are processes, not LLM features

The orchestrator owns the process lifecycle, the working directory, the model selection, and the result protocol. The LLM inside the subagent does not know it's a subagent.

**Test of compliance:** A subagent's system prompt does NOT mention "you are a subagent" or any orchestration-specific language. The subagent is just an agent with a constrained tool list, a small working directory, and an explicit task brief.

**Why:** Subagent-awareness in the prompt is leaky abstraction that biases the LLM and makes debugging harder. Treat the LLM as a stateless function over (system_prompt, task, tools).

### Principle 5 — Token efficiency is measurable, not folkloric

Every decision that claims "saves tokens" MUST come with a benchmark scenario and a number. If you can't measure it, it doesn't ship.

**Test of compliance:** Every PR with a "saves tokens" or "improves cache hit" claim in the body has a corresponding before/after measurement in the PR description, recorded against the M2 reference project.

**Why:** Token optimization is the project's north star. Letting unmeasured claims accumulate dilutes the metric and lets regressions hide.

### Principle 6 — Static checks before LLM calls, always

The verification ladder runs zero-token checks first. LLM-based QA is the escalation, not the default. The order is fixed: typecheck → lint → unit tests → integration tests → LLM QA. Skipping levels is not configurable; reordering them is not configurable.

**Test of compliance:** `packages/core/verification/runner.ts` runs the ladder in this exact order, with each step's pass/fail explicit in the journal. No step can be skipped unless the previous step failed (and even then, only the LLM step skips — static steps never skip).

**Why:** Static checks are free. LLM calls cost money and time. Doing them in the wrong order is wasteful and breaks the metric in Principle 5.

### Principle 7 — Fresh sessions per task by default

Context accumulation is the enemy. New session per Dev task, per Scout query, per Architect decision. Compaction is a last resort, not a strategy.

**Test of compliance:** `packages/orchestration/src/dispatcher.ts` creates a new Pi session (via `createAgentSession({sessionManager: SessionManager.inMemory()})` or `--no-session`) for every dispatched task by default. Session reuse requires an explicit `reuseSession: true` flag, documented in the task brief, and a justification recorded in the dispatch journal.

**Why:** Long conversations bias models, blow context windows, and dilute the methodology's intent. The methodology already separates concerns (Scout vs Architect vs Dev vs QA); sessions should follow that separation.

### Principle 8 — The dashboard is the primary UX

v2.x set this direction; v3 doubles down. The CLI exists for headless / CI / power-user fallback. New features land in the dashboard first.

**Test of compliance:** Every feature ADR has a "Dashboard surface" section. If the feature has no dashboard surface, the ADR explains why (CLI-only, internal, deferred).

**Why:** A localhost dashboard with SSE updates beats a TUI for everyone who isn't a power-user typing in tmux. v2.3.x's user analytics confirmed dashboard adoption; doubling down is data-driven.

### Principle 9 — Crash-safety is non-negotiable

Any operation that creates a worktree, an LLM session, or a long-running process MUST be resumable from disk state after `kill -9`. Lock files + PID liveness + structured journals everywhere.

**Test of compliance:** The M3 chaos test suite (§14.10) runs `SIGKILL` injection at every state transition in the orchestrator FSM. All transitions resume cleanly. CI fails if a single resume case regresses.

**Why:** Long-running multi-LLM dispatches that lose state on crash are user-hostile. The cost of crash-safety (lock files, journal writes) is small; the cost of losing 30 minutes of LLM work is large.

### Principle 10 — Compose, don't fork

When Pi gains a feature, we use it. When Pi has a bug, we file an issue and possibly carry a patch — we don't fork the SDK.

**Test of compliance:** No file under `packages/` imports from a vendored copy of Pi. No `package.json` declares `@earendil-works/*` with a git/url dependency; all are versioned npm dependencies.

**Why:** Forking creates parallel maintenance burden we can't sustain. Patch-and-upstream is the only durable strategy.

### Principle 11 — One source of truth per concern

Configuration lives in `.swt-planning/config.json`. Provider quirks live in `runtime/providers/quirks.json`. Role-tier mapping lives in `runtime/role-resolver.ts`. Task plans live in `.swt-planning/phases/NN-slug/plans/`. Cassette fixtures live in `packages/test-utils/cassettes/`. **No concern has two homes.**

**Test of compliance:** When you ask "where does X live?", you get exactly one answer. Reviewers reject PRs that introduce parallel configuration paths.

**Why:** Multiple sources of truth produce silent skew. The methodology engine's correctness depends on configurations matching themselves.

### Principle 12 — Determinism in the test path

The cassette infrastructure (§14.7) records LLM responses. Tests that use cassettes MUST produce byte-identical token counts and event ordering on replay. Non-determinism is a bug to be fixed at the source, not a flag to be added.

**Test of compliance:** `vitest run --reporter=verbose` produces identical output across three back-to-back runs on the same machine. The integration test suite fails CI if the cassette replay diverges from the recorded run by more than the documented tolerance (defaults: zero-byte for token counts, deterministic ordering for events).

**Why:** Flaky tests hide regressions. Non-determinism in token counts hides the very metric we're optimizing.

---

## 3. Current-State Audit (v2.3.5)

> **Δ from TDD.md§3:** TDD.md§3 was correct in shape but vague on file counts and missed one critical architectural debt (the `methodology → codex-driver` edge). This section is grounded in the actual cloned v2.3.5 source at `.vbw-planning/research/swt-v2-source/`.

### 3.1 Workspace layout

```
swt-labs/stop-wasting-tokens @ v2.3.5
├── package.json                 # name: stop-wasting-tokens; bin: swt → ./dist/cli.mjs
├── pnpm-workspace.yaml          # packages: ., packages/*, docs
├── tsup.config.ts               # builds the single ESM bundle for npm
├── vitest.config.ts             # vitest root config; per-package configs extend
├── tsconfig.base.json           # strict mode, ESNext, NodeNext modules
├── tsconfig.{build,eslint,json}.json
├── eslint.config.mjs            # flat ESLint v9 config
├── .prettierrc                  # 2-space, single-quote, trailing-comma=all
├── .editorconfig
├── .nvmrc                       # 20  (CI matrix adds Node 22)
├── .gitignore                   # excludes dist/, node_modules/, coverage/, .pnpm-store/
├── .gitattributes
├── packages/                    # 11 workspace packages (see §3.2)
├── docs/                        # 41 files across the v2 docs tree (reorganized in v3 per §18.1)
├── scripts/                     # 5 build/release scripts
├── skills/                      # 6 first-party skills
├── templates/                   # init/scaffold templates
├── test/                        # 2 root-level test files; bulk lives in packages/
├── a_non_production_files/      # OUT OF SCOPE for v3
├── .changeset/                  # release automation (v2 commits)
├── .codex-plugin/               # ⚠ DELETED in v3
├── .github/workflows/           # 5 workflows (§3.4)
├── CLAUDE.md                    # VBW-style context file (33KB)
├── README.md                    # 33KB user-facing
├── CHANGELOG.md                 # 84KB; preserved in v3 as v2-baseline.md
├── CONTRIBUTING.md, CODE_OF_CONDUCT.md, LICENSE, SECURITY.md
├── LAUNCH-CHECKLIST.md          # v1.0 launch artefact; archived in v3
├── RELEASE-NOTES-v1.0.md, SECURITY-REVIEW-v1.0.md  # archived in v3
└── pnpm-lock.yaml               # 427KB; regenerated under @earendil-works/* deps in M1
```

Node engine: `>=20.18`. Package manager: `pnpm@9.12.0`. TypeScript `^5.6.3`. Vitest `^2.1.3`.

### 3.2 Per-package inventory

The 11 workspace packages, with file-level disposition:

#### 3.2.1 `@swt-labs/core` — Type definitions and abstractions

```
packages/core/src/
├── abstractions/
│   ├── AgentSpawner.ts          # interface; ⚠ codex-coupled in v2; rewritten in v3
│   ├── HookHost.ts              # interface; v3 keeps; Pi Extension hooks satisfy this
│   ├── MemoryStore.ts           # interface; v3 keeps; Pi session entries satisfy this
│   ├── PermissionGate.ts        # interface; v3 keeps + extends with UiPermissionGate
│   ├── Prompter.ts              # interface; v3 keeps unchanged
│   └── index.ts
├── config/                      # schema-shaped config loader
├── errors/                      # SWT error hierarchy
├── handoff/                     # phase → phase handoff envelopes
├── scaffold/                    # project scaffold helpers (init flow)
├── types/                       # primitive types reused across packages
└── index.ts
```

**v3 disposition:** `core/abstractions/AgentSpawner.ts` is rewritten to dispatch via `packages/runtime/` and `packages/orchestration/`. All other abstractions kept. The package is split in v3: `abstractions/` and `handoff/` move into `packages/core/methodology/`; `types/` and the Zod schemas move into `packages/shared/`. The legacy `@swt-labs/core` symbol is preserved as a re-export shim for one release cycle (v3.0.x), then deleted in v3.1.

#### 3.2.2 `@swt-labs/artifacts` — Methodology artefact engine

```
packages/artifacts/src/
├── atomic-write.ts              # POSIX-safe atomic file writes via rename
├── frontmatter.ts               # YAML frontmatter parser/emitter
├── bootstrap/                   # PROJECT.md / REQUIREMENTS.md scaffold
├── milestones/                  # milestone directory engine + index
├── phases/                      # phase directory engine + plan-numbering rules
├── qa/                          # QA-tier definitions
├── roadmap/                     # ROADMAP.md parse/emit
├── schemas/                     # Zod schemas — the single source of truth
├── state/                       # STATE.md parse/emit + activity log
└── index.ts
```

**v3 disposition:** Migrated intact to `packages/core/artefacts/` (renamed from `artifacts/` to the British spelling used throughout the methodology). No code-level changes; only the `package.json` namespace flips from `@swt-labs/artifacts` to `@swt-labs/core/artefacts` (subpath export). Zod schemas gain a top-level `schema_version: 1` field — this is the only on-disk schema change in v3.0.

#### 3.2.3 `@swt-labs/methodology` — Six-agent SDLC

```
packages/methodology/src/
├── audit/                       # codebase-audit subsystem (used by Scout role)
├── discussion/                  # discussion-mode protocol (vibe loop)
├── memory/                      # session-bound memory (vs core.MemoryStore)
├── profiles/                    # role-profile definitions (six roles)
├── prompt-builder/              # buildPrompt() with deterministic ordering
├── qa/                          # goal-backward QA tier orchestration
├── state/                       # phase state machine
├── vibe/                        # the vibe-mode interactive loop
└── index.ts
```

**v3 disposition:** Migrated intact to `packages/core/methodology/`. **One required surgery before M1 can start:** the v2.3.5 `packages/methodology/package.json` declares `@swt-labs/codex-driver` as a runtime dependency, and `packages/methodology/src/` imports from it. This edge VIOLATES Constitutional Principle 1 (methodology is vendor-agnostic) and Principle 3 (provider is a parameter). It MUST be broken first.

**The break is mechanical:** the methodology calls `codex-driver` for two things in v2.3.5 — spawning a subagent and writing per-agent TOML hooks. In v3, these become calls into `packages/orchestration/` (which itself calls into `packages/runtime/`). The methodology never imports a driver directly again. The break is the **entry gate for M1**, not its result.

#### 3.2.4 `@swt-labs/cli` — The `swt` command surface

```
packages/cli/src/
├── argv.ts                      # argv parser (no yargs/commander; hand-rolled)
├── commands/                    # one file per verb
│   ├── config.ts                # `swt config` — v2.3 dashboard CLI parity
│   ├── dashboard.ts             # `swt dashboard` — daemon launcher
│   ├── detect-phase.ts          # `swt detect-phase`
│   ├── doctor.ts                # `swt doctor` — environment checks
│   ├── init.ts                  # `swt init` — project scaffold
│   ├── status.ts                # `swt status`
│   ├── stubs.ts                 # ⚠ 21 NOT_IMPLEMENTED VERBS — DISMANTLED in v3 per §3.2.4 disposition table
│   ├── update.ts                # `swt update` — self-update via npm
│   ├── version.ts               # `swt version`
│   ├── vibe.ts                  # `swt vibe` — primary methodology loop
│   └── watch.ts                 # `swt watch` — chokidar file watcher
├── exit-codes.ts                # EXIT.{SUCCESS, USAGE_ERROR, NOT_IMPLEMENTED, RUNTIME_ERROR}
├── help.ts                      # `swt help` output
├── lib/                         # CLI utilities (table renderers, color, etc.)
├── lifecycle/                   # process lifecycle (signal handling)
├── main.ts                      # entrypoint
├── prompters/                   # interactive prompts (used by init, doctor)
├── router.ts                    # CommandRegistry + dispatch()
└── watch/                       # chokidar wrappers
```

**v3 disposition:**

- `commands/stubs.ts` is **DISMANTLED**, not blanket-deleted. The 21 stub verbs in v2.3.5 (verified by reading the file) are v3 *roadmap markers*; v3 cashes them in.
- `commands/dashboard.ts`, `vibe.ts`, `init.ts`, `doctor.ts`, `detect-phase.ts`, `status.ts`, `config.ts`, `update.ts`, `version.ts`, `watch.ts` **PRESERVED** with internals rewired to call orchestration/runtime instead of codex-driver.
- The `router.ts` `CommandRegistry` design (registry + dispatch with `EXIT.USAGE_ERROR` on unknown verb) is preserved verbatim.
- `EXIT.NOT_IMPLEMENTED` (constant value 2) is **retained** in `exit-codes.ts` for external tooling that may grep the numeric API, but no v3 verb returns it.

**Stub verb disposition table** (verified 2026-05-11 against `packages/cli/src/commands/stubs.ts` in v2.3.5; 21 verbs total):

| v2 stub | v3 disposition | Lands in | Notes |
|---|---|---|---|
| `plan` | **IMPLEMENT** | M2 PR-12 | Wraps the methodology's Lead+Architect dispatch; flag `--phase NN` selects phase. |
| `execute` | **FOLD into `vibe`** | M2 PR-15 | The vibe loop already executes; a separate `execute` verb duplicates surface. Reintroduction requires an ADR. |
| `qa` | **IMPLEMENT** | M2 PR-14 | Runs the static-check ladder + LLM QA tier escalation (§14.11). |
| `map` | **IMPLEMENT** | M2 | Dispatches the audit subsystem (§11.6) as a Scout task. |
| `debug` | **IMPLEMENT** | M3 | Dispatches the Debugger role (§10.1). Useful standalone for users post-incident. |
| `fix` | **FOLD into `vibe`** | M2 | Small-fix path is a vibe shortcut, not a separate verb. |
| `archive` | **IMPLEMENT** | M6 PR-47 | Milestone archive routine; produces the HTML report (§3.7). |
| `release` | **DROP** | (n/a) | Releases go through Changesets + GH Actions (§15.6); a CLI verb adds nothing. |
| `resume` | **FOLD into `vibe --resume`** | M2 | Pi's session resume is exposed through `vibe -c` / `vibe -r`. |
| `pause` | **IMPLEMENT** | M4 | Required for the Budget Gate pause flow (§8.4). |
| `audit` | **IMPLEMENT** | M6 PR-47 | Pre-archive audit matrix; runs before `archive`. |
| `assumptions` | **IMPLEMENT** | M2 | Captures phase assumptions into `.swt-planning/assumptions/`. |
| `research` | **IMPLEMENT** | M2 | Scout-only standalone (no plan, no Lead). |
| `discuss` | **FOLD into `vibe`** | M2 | The vibe loop is the discussion engine; a separate verb is duplicative. |
| `phase` | **IMPLEMENT** | M2 | Add/insert/remove phases in ROADMAP.md. |
| `todo` | **IMPLEMENT** | M2 | STATE.md todo manager (small). |
| `skills` | **IMPLEMENT** | M5 | Wraps Pi's skill install + discovery surface; `swt skills install <pkg>`. |
| `whats-new` | **IMPLEMENT** | M6 | Shows release notes from CHANGELOG.md. |
| `uninstall` | **IMPLEMENT** | M6 | Removes SWT artifacts; small. |
| `worktree` | **IMPLEMENT** | M3 PR-22..PR-29 | Manage active worktrees from CLI (`list`, `abort`, `cleanup`). |
| `lease` | **IMPLEMENT** | M3 PR-25 | Lock-file inspection + manual release (operator escape hatch). |

**Migration mechanics:**

1. `commands/stubs.ts` is decomposed PR-by-PR; each verb moves into its own `commands/<verb>.ts` file when implemented (matching the v2 pattern for the 10 preserved verbs).
2. Until a stub is implemented, it continues to return `EXIT.NOT_IMPLEMENTED` from `stubs.ts` so the CI smoke tests stay green.
3. The last stub-removal PR (M6 PR-46) deletes `commands/stubs.ts` after the table above is exhausted.

**New verbs added in v3 (not stubs):**

- `swt migrate` (the v2.x → v3 migration helper) — see §13.6.
- `swt rpc` (delegates to Pi's `runRpcMode`) — exposes Pi RPC mode under the `swt` name for tools that want a single-binary integration.
- `swt bench` (runs the TPAC reference benchmark) — see §14.9.
- `swt cleanup` (worktree retention sweep) — see §9.7.

#### 3.2.5 `@swt-labs/dashboard` — Hono + Solid dashboard

```
packages/dashboard/src/
├── server/
│   ├── index.ts                 # Hono app + SSE bridge
│   ├── event-bus.ts             # in-process event bus
│   ├── snapshot/                # state snapshot model
│   │   ├── diff.ts              # snapshot diffing
│   │   ├── reducer.ts           # event → snapshot reducer
│   │   ├── empty.ts             # initial snapshot
│   │   ├── events-tailer.ts     # tails .swt-planning/events/ files
│   │   ├── scanner.ts           # directory scanner
│   │   └── snapshotter.ts       # snapshot construction
│   ├── routes/                  # Hono routes (see §3.2.6 for the surface)
│   │   ├── snapshot.ts          # GET /api/snapshot, GET /api/snapshot/sse
│   │   ├── vibe.ts              # POST /api/vibe/* — vibe-loop control
│   │   ├── doctor.ts            # GET /api/doctor — env probe
│   │   ├── commands.ts          # GET /api/commands — verb metadata
│   │   ├── init.ts              # POST /api/init — project scaffold
│   │   └── events.ts            # GET /api/events/sse
│   ├── markdown/render.ts       # remark+rehype markdown pipeline
│   ├── lib/                     # 9 server utilities
│   │   ├── command-registry-mirror.ts  # mirrors CLI registry for the dashboard
│   │   ├── detect-brownfield.ts        # detects existing repo state
│   │   ├── find-project-root.ts        # ascends until .swt-planning/ found
│   │   ├── safe-path.ts                # path traversal guard
│   │   ├── binding-guard.ts            # 127.0.0.1-only bind enforcement
│   │   ├── detect-codex.ts             # ⚠ DELETED in v3
│   │   ├── csp.ts                      # CSP header generation
│   │   ├── tail-file.ts                # streaming file tail
│   │   └── allowed-verbs.ts            # whitelist for dashboard-triggered verbs
│   └── vibe/                    # server-side vibe-loop logic
│       ├── loop.ts              # vibe loop orchestration
│       ├── markers.ts           # progress markers
│       ├── methodology-agent.ts # vendor-neutral methodology agent
│       ├── codex-methodology-agent.ts  # ⚠ DELETED in v3
│       ├── session.ts           # session lifecycle
│       └── permission-gate.ts   # DashboardPermissionGate (session-keyed)
└── client/                      # Solid SPA (built by `pnpm dashboard:client:build`)
```

**v3 disposition:** Migrated intact with three deletions and two extensions:

- `lib/detect-codex.ts` **DELETED**.
- `vibe/codex-methodology-agent.ts` **DELETED**. The `methodology-agent.ts` becomes the only methodology agent.
- `vibe/permission-gate.ts` (the `DashboardPermissionGate`) is **PRESERVED** and **extended** with a sibling `UiPermissionGate` class for direct UI mutations — this is the deferred work flagged in v2.3.x and now lands in M2. POSTs originating from UI button clicks (vs vibe sessions with `session_id`) route through `UiPermissionGate`.
- New routes (full list in §12.1's new-routes table): `GET /api/worktrees` + `GET /api/worktrees/sse` + `POST /api/worktrees/:id/abort` (M3), `GET /api/meter/sse` + `GET /api/cache-hits/sse` + `GET /api/budget/sse` + `POST /api/budget/resume` (M4), `GET /api/cost/sse` (M5), `GET /api/metrics` (M2, opt-in).
- New panels in the SPA: Worktrees (M3), Cache Hits (M4), Budget (M4), Per-Provider Cost (M5).
- Layout-storage v2 (5-column main + tools array) — **PRESERVED**.
- cmd-K palette with subsequence fuzzy match — **PRESERVED**.

#### 3.2.6 `@swt-labs/dashboard-core` — Shared schemas

```
packages/dashboard-core/src/
├── schemas/                     # Snapshot, SnapshotEvent, ApiSchemas (Zod)
└── index.ts
```

**v3 disposition:** Folded into `packages/shared/` along with `core/types/`. The standalone `dashboard-core` package goes away in v3 — its only purpose in v2 was to break a circular-dependency between `cli` and `dashboard`, which v3 solves architecturally by routing both through `shared/`.

#### 3.2.7 `@swt-labs/verification` — Goal-backward QA pipeline

```
packages/verification/src/
├── checks/                      # individual check implementations
├── guards/                      # static-check guards (tsc, eslint, etc.)
├── circuit-breaker.ts           # blocks LLM QA after N static failures
├── runner.ts                    # ladder runner (Principle 6)
├── traceability.ts              # requirement-to-test traceability
└── index.ts
```

**v3 disposition:** Migrated intact to `packages/core/verification/`. The ladder order (Principle 6) is canonicalized in `runner.ts` and made non-configurable. The circuit-breaker integrates with the new Budget Gate (§8.4).

#### 3.2.8 `@swt-labs/telemetry` — Opt-in metrics

```
packages/telemetry/src/
├── anonymous-id.ts              # opt-in anonymous identifier
├── client.ts                    # public API
├── events.ts                    # event-type registry
├── http-sender.ts               # HTTP sink (when opt-in)
├── sanitize.ts                  # PII/path sanitization
├── sender.ts                    # sender interface
└── index.ts
```

**v3 disposition:** Migrated intact to `packages/core/telemetry/`. The event registry expands with M2/M3/M4/M5/M6 events (worktree lifecycle, cache hits, budget pressure, provider failover, TPAC measurements). Opt-in boundary remains identical.

#### 3.2.9-3.2.11 The three drivers — **DELETED**

```
packages/codex-driver/         # @swt-labs/codex-driver
├── src/
│   ├── agents-md/              # AGENTS.md generators per role
│   ├── hooks/                  # codex hooks.json writer
│   ├── prompts/                # codex-specific prompt scaffolds
│   ├── skills/                 # skill installer for codex
│   ├── spawn/                  # `codex exec` subprocess wrapper
│   ├── spawner/                # AgentSpawner impl for codex
│   ├── toml/                   # TOML agent emitter
│   ├── paths.ts                # codex install path detection
│   ├── version.ts              # codex CLI version check
│   └── index.ts

packages/claude-code-driver/   # @swt-labs/claude-code-driver
├── src/
│   ├── hooks/, spawn/, spawner/
│   └── index.ts

packages/ollama-driver/        # @swt-labs/ollama-driver
├── src/
│   ├── sandbox/, spawn/, spawner/
│   └── index.ts
```

All three packages are **deleted wholesale** in M1. No re-export shims. The `package.json` workspace entries are removed; the directories are `git rm -r`'d. Any external consumer that depended on these is migrated via `swt migrate --to=v3` or instructed to pin v2.3.x.

The skills shipped via `codex-driver/skills/` are migrated to the Pi skill discovery path (`.pi/skills/` or `.swt-planning/skills/`) per §5.4.

### 3.3 Dependency graph (v2.3.5)

The actual edges, derived from `package.json` files (verified):

```
cli ──► artifacts, claude-code-driver, codex-driver, methodology, ollama-driver, telemetry, verification, core
dashboard ──► cli, core, dashboard-core, methodology
methodology ──► artifacts, codex-driver, core              ⚠ violates Principle 3
artifacts ──► core
codex-driver ──► core
claude-code-driver ──► core
ollama-driver ──► core
verification ──► core
telemetry ──► core
dashboard-core ──► (zod only, no internal)
```

**Constitutional debt visible in the graph (verified):**

1. **`methodology → codex-driver`** (Principle 1 + 3 violation). Concrete site: `packages/methodology/src/vibe/handlers/bootstrap.ts` imports `writeAgentsMdBlock` from `@swt-labs/codex-driver`. This is the headline debt because Layer 3 (methodology) MUST be vendor-agnostic.
2. **`cli → {codex,claude-code,ollama}-driver`** (more severe than originally thought; three driver edges in one verb). Concrete sites (all verified):
   - `packages/cli/src/commands/vibe.ts` imports `CodexAgentSpawner` (codex-driver), `ClaudeCodeAgentSpawner` (claude-code-driver), and `OllamaAgentSpawner` (ollama-driver). The verb dispatches on `backend:` config to pick which to instantiate.
   - `packages/cli/src/commands/doctor.ts` imports `detectCodexVersion` + `CodexVersion` from codex-driver.

   The CLI is Layer 5 (allowed to know about runtimes) but in v3 it MUST route through `packages/runtime/` instead of importing a driver directly.
3. **`cli → claude-code-driver` and `cli → ollama-driver`** (workspace deps in `packages/cli/package.json`, also Principle 3 surface — currently unused in source but kept as dependency rows). These vanish with the driver packages in PR-05.

**M1 entry gate (§13.1.1) discharges both #1 and #2 before any Pi work.** The discharge sequence:

- **PR-01a (the entry gate):** break the `methodology → codex-driver` edge — replace `writeAgentsMdBlock` usage with a call through `core/abstractions/AgentSpawner`; remove the dep from `methodology/package.json`.
- **PR-01b (paired with PR-01a in the same gate, separate commit for reviewability):** introduce a `core/abstractions/SpawnerEnvironment` adapter the CLI consumes for `doctor` / `vibe`. Remove **all three** driver imports from `cli/src/commands/vibe.ts` (`CodexAgentSpawner`, `ClaudeCodeAgentSpawner`, `OllamaAgentSpawner`) and the `codex-driver` import from `cli/src/commands/doctor.ts` (`detectCodexVersion`, `CodexVersion`). The backend-selection if/else logic inside vibe.ts moves into `SpawnerEnvironment.getSpawner()`. Methodology + CLI both depend on abstractions only.

After PR-01a + PR-01b are merged, **no source file outside `packages/{codex,claude-code,ollama}-driver/` imports a driver**. The three driver packages are then deletable in PR-05 (per §13.1.2) with zero collateral.

The graph's `cli → claude-code-driver` and `cli → ollama-driver` edges are workspace `package.json` declarations only (the source never imports them); they vanish when the driver packages are removed.

### 3.4 CI/CD inventory

Five GitHub Actions workflows in `.github/workflows/`:

#### 3.4.1 `ci.yml` — verified content

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    name: ${{ matrix.os }} / Node ${{ matrix.node }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Lint
        run: pnpm lint
      - name: Format check
        run: pnpm format:check
      - name: Test
        continue-on-error: true       # ⚠ advisory in v2.3.5; required in v3
        run: pnpm test
      - name: Build
        run: pnpm build
```

**Matrix:** OS (ubuntu/macos/windows) × Node (20, 22) = 6 jobs.

**Status of each step in v2.3.5:**

- **Typecheck**: required (gating). Required since v1.5.2 Phase 01.
- **Lint**: required. Required since v1.5.2 Phase 02.
- **Format check**: required. Required since v1.5.2 Phase 03.
- **Test**: **advisory** (`continue-on-error: true`). 33 pre-existing failures, documented as v1.0/DEV-1D-class carryforward; closing them was out of scope for the v2.3 milestone.
- **Build**: required.

**v3 changes (§15):**

- The `Test` step becomes **required**, gating. The 33 v2.x failures are remediated in M1.
- A new job `provider-matrix` runs the provider compatibility test suite on PR + nightly.
- A new job `regression-cassette` runs the cassette-replay suite as a separate gate.
- The Windows matrix entry is **kept** (TDD.md was silent on Windows; v3 commits to it because the worktree path needs cross-OS validation per §9.1).

#### 3.4.2 Other workflows (file-level only; bodies read inline during §15 drafting)

- `codeql.yml` — CodeQL security scanning
- `install-smoke.yml` — install-smoke matrix across npm/pnpm/bun × ubuntu/macos (shipped in v2.3.x; ran per-patch)
- `release.yml` — Changesets-driven npm publish with provenance
- `vale.yml` — Vale style linting for docs

All five are preserved in v3 with additions detailed in §15.

### 3.5 Test coverage map

**130 `*.test.ts` files** in `packages/*/test/` plus 2 root-level tests in `test/`. Distribution by package (verified via `find packages -name "*.test.ts"`):

| Package | Test file count | Test type |
|---|---|---|
| (per-package; full enumeration produced during M1 PR-01 as part of the test-debt cleanup) | ≥ 130 total | unit + integration mix |
| `test/` (root) | 2 | manifest + docs-drift |

The 33 known failures (per `ci.yml` comment) cluster in the methodology package (DEV-1D-class carryforward) plus Prettier-induced fixture drift. M1 PR-01's deliverable is: enumerate, classify, and either fix or document as `@vitest skip` with a tracking issue — `continue-on-error: false` lands at the M1 gate.

### 3.6 What dies on day one

Listed in TDD.md§3.2 with these additions/clarifications:

- **`packages/codex-driver/`** — entire directory
- **`packages/claude-code-driver/`** — entire directory
- **`packages/ollama-driver/`** — entire directory
- **`.codex-plugin/`** — entire directory at repo root
- **`packages/cli/src/commands/stubs.ts`** — file deleted at the end of M6 PR-46, after the 21 stub verbs are individually migrated (implemented / folded / dropped) per the disposition table in §3.2.4
- **`packages/dashboard/src/server/lib/detect-codex.ts`**
- **`packages/dashboard/src/server/vibe/codex-methodology-agent.ts`**
- **All `agents-md/` TOML generators** (codex-specific; AGENTS.md becomes a user-authored file consumed by Pi natively)
- **`backend: codex | claude-code | ollama` config field** in `.swt-planning/config.json` (replaced by `roles[*].tier` mapping)
- **Codex-specific OAuth handling** in `core/` (Pi handles OAuth uniformly across providers via `~/.pi/agent/auth.json`)
- **Any `import` from `@swt-labs/codex-driver|claude-code-driver|ollama-driver`** anywhere in the tree
- **Any reference to "GSD" or legacy plugin isolation in the source CLAUDE.md** (cleanup; not a code change)

### 3.7 What we steal from GSD-2

GSD-2 (also Pi-based) has already proven these patterns; v3 adopts them. Sourced from `TDD.md§3.3` and confirmed against the v2 CLAUDE.md history:

- Per-task fresh sessions with explicit context inlining (matches Principle 7)
- Git worktree per milestone (v3 extends to per-task)
- `.gsd/parallel/` file-IPC pattern (v3 adopts as `.swt-planning/parallel/`)
- PID liveness checks for crash recovery
- Headless mode with structured exit codes (0/1/2/3)
- HTML report generation post-milestone
- `verification_commands` for static-check gates

We do not copy GSD-2 wholesale. We take the patterns and integrate them with SWT's existing methodology surface. The on-disk schema is SWT's (`.swt-planning/`), not GSD-2's (`.gsd/`); cross-pollination is at the pattern level.

---

## 4. Target Architecture

### 4.1 Layered overview

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Public Surface                                    │
│  CLI verbs · Headless mode · RPC mode · SDK exports         │
│  packages/cli/                                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Dashboard                                         │
│  Hono server · Solid SPA · SSE bridge · Permission gates    │
│  packages/dashboard/                                        │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Methodology (PRESERVED FROM v2)                   │
│  Phase lifecycle · Roles · Artefacts · Must-haves · QA      │
│  packages/core/                                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Orchestration                                     │
│  Worktree dispatcher · DAG resolver · Result harvester      │
│  Role→tier→model resolver · Budget enforcer · Token meter   │
│  packages/orchestration/                                    │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Runtime Adapter (thin interface over Pi)          │
│  Session factory · Tool factory · Event normalization       │
│  Cache-control insertion · Provider quirk shims             │
│  packages/runtime/                                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 0: Pi SDK (external dependency)                      │
│  @earendil-works/pi-coding-agent · pi-ai · pi-agent-core    │
└─────────────────────────────────────────────────────────────┘
```

**Dependency direction is strictly downward.** Layer 3 (methodology) never imports from Layer 4 (dashboard). Layer 1 (runtime adapter) never imports from Layer 3 (methodology). The interfaces between layers are the test seams.

There is one **controlled lateral channel**: Pi's Extension API (§5.4). SWT-built extensions can register tools, providers, hooks, and commands at runtime. These extensions live in `packages/runtime/src/extensions/` and are loaded by the runtime adapter at session-creation time. They participate in the lateral channel — but they cannot import from Layer 3 or above. ESLint enforces this with `import/no-restricted-paths`.

### 4.2 Why a runtime adapter (Layer 1) instead of using Pi directly

Three reasons, in priority order:

1. **Testability.** Mocking Pi at the Layer 1 interface lets the entire methodology layer be unit-tested without LLM calls. The cassette infrastructure (§14.7) plugs into Layer 1's `Session` and `Tool` interfaces, not into Pi's.

2. **Cross-cutting concerns.** Cache-control insertion, token metering, cost aggregation, budget enforcement, and provider failover happen here — once — not scattered across the orchestrator. The runtime adapter is the *only* place that knows the difference between an Anthropic 5xx and an OpenAI 5xx.

3. **Future-proofing.** Pi's API will change before its 1.0 release. The adapter localizes that churn. The rule is: when Pi changes, the diff lands in `packages/runtime/`; everything above never knows.

The adapter is **thin**. It does not reinvent Pi concepts; it normalizes them. **Rule of thumb: if a function in `runtime/` is more than 50 lines, ask whether it's leaking methodology into the adapter.** PR reviewers reject runtime/ functions over 80 lines unless the PR description explains why the rule doesn't apply.

### 4.3 Dependency rules + test seams

**Allowed imports (enforced by ESLint via `import/no-restricted-paths`):**

| From | May import from |
|---|---|
| `packages/cli/` | `packages/dashboard/`, `packages/core/`, `packages/orchestration/`, `packages/runtime/`, `packages/shared/` |
| `packages/dashboard/` | `packages/core/`, `packages/orchestration/`, `packages/runtime/`, `packages/shared/` |
| `packages/core/` | `packages/shared/` |
| `packages/orchestration/` | `packages/core/`, `packages/runtime/`, `packages/shared/` |
| `packages/runtime/` | `packages/shared/` |
| `packages/shared/` | (none — leaf) |
| `packages/test-utils/` | any |

**Forbidden imports:**

- `packages/core/` cannot import `@earendil-works/*` (any Pi package). This violates Principle 1.
- `packages/core/` cannot import `packages/runtime/`, `packages/orchestration/`, `packages/dashboard/`, `packages/cli/`. This violates Principle 1.
- `packages/runtime/` cannot import `packages/core/`. This violates Principle 2.
- `packages/orchestration/` cannot import `packages/dashboard/` or `packages/cli/`.
- `packages/shared/` cannot import anything except std/zod/typebox/tsc-types.

The ESLint rule lives in `eslint.config.mjs` and is non-overridable. PRs that disable it fail CI.

**Test seams (where mock boundaries land):**

- **Layer 0 ↔ Layer 1**: `packages/runtime/src/session.ts` exposes `createSession()` and `createTools()`. Tests inject a mock `AgentSession` interface; the cassette infrastructure also injects here.
- **Layer 1 ↔ Layer 2**: `packages/orchestration/src/dispatcher.ts` consumes the `Session` and `TaskResult` interfaces. Tests stub these.
- **Layer 2 ↔ Layer 3**: `packages/core/methodology/src/prompt-builder/` consumes the `PromptContext` shape from `shared/`. Tests stub the dispatcher.
- **Layer 3 ↔ Layer 4**: `packages/dashboard/src/server/vibe/methodology-agent.ts` consumes the methodology API. Tests stub the methodology.
- **Layer 4 ↔ Layer 5**: `packages/cli/src/commands/dashboard.ts` launches the daemon. Tests stub the daemon.

Each seam has a corresponding `.test.ts` file demonstrating the mock boundary.

### 4.4 Crash-safety model

Every operation that creates a worktree, an LLM session, or a long-running process MUST be resumable from disk state after `kill -9` (Principle 9).

**The model has three primitives:**

1. **Lock files.** Every dispatched task acquires a lock at `.swt-planning/locks/task-<id>.lock`. The lock file contains:
   ```json
   {
     "schema_version": 1,
     "task_id": "T-2026-05-11-001",
     "worktree_path": ".swt-planning/parallel/wt-T-2026-05-11-001/",
     "pid": 12345,
     "started_at": "2026-05-11T14:00:00.000Z",
     "phase": "dispatching"  // dispatching | running | harvesting | done
   }
   ```
   The lock is held until the task transitions to `done`. If `pid` is no longer alive (verified via `kill -0 <pid>`), the lock is considered stale and reclaimable.

2. **PID liveness.** Before any orchestrator action that depends on a peer process, the orchestrator runs `kill -0 <pid>` on the peer's recorded PID. A stale lock + dead PID triggers the recovery path (§9.5).

3. **Structured journals.** Every state transition is appended to `.swt-planning/journal/<date>.jsonl` as a single JSON line with `{timestamp, actor, task_id, from, to, payload?}`. The journal is the source of truth for resume; the in-memory state is rebuilt by replaying the journal from the last checkpoint.

**Recovery is mechanical, not heuristic.** On startup, the orchestrator scans `.swt-planning/locks/`, identifies stale locks (dead PID + journal shows incomplete transition), and either resumes (if the worktree state is intact) or aborts (if the worktree was mid-edit and may be inconsistent). The decision is deterministic and journaled.

The full FSM and recovery cases are in §9.5.

### 4.5 Concurrency model

**Three units of concurrency:**

1. **Worktrees** — one per parallel task. A worktree is a `git worktree add` directory inside `.swt-planning/parallel/wt-<task-id>/`. Each worktree has its own working directory state and its own Pi session.

2. **Pi sessions** — one per task. Created via `createAgentSession({cwd: worktreePath, sessionManager: SessionManager.inMemory()})` for ephemeral tasks, or `SessionManager.create(worktreePath)` for persistable tasks. Sessions are isolated: changing model in session A does not affect session B.

3. **Claims** — file-level locks within the methodology pipeline. Each task declares a `claims: ["path/to/file.ts", "another/file.ts"]` array in its plan. The claim registry (§9.2) rejects parallel tasks that would touch the same claim path.

**Parallelism is bounded:**

- The DAG resolver (§9.3) batches tasks that have no overlapping claims and no dependency edges.
- The max parallelism is `min(config.max_parallel_tasks, available_worktree_slots, provider_quota_remaining)`.
- The budget gate (§8.4) can downgrade parallelism dynamically when token-cost pressure rises.

**Failure isolation:** A failure in one task's worktree does NOT affect peer worktrees. The worktree is `git worktree remove`'d (or kept for forensics, depending on config), and the task's lock is released.

---

## 5. Pi SDK Integration Reference

> **Δ from TDD.md:** TDD.md cited Pi API symbols without verification. Several were wrong (`@mariozechner/*` namespace, `shouldStopAfterTurn`, `report_result`). This section is a **verified reference** against `pi.dev/docs/latest` as of 2026-05-11. Every symbol is grounded; symbols that are not verifiable are explicitly flagged.
>
> **Status legend:**
> - **VERIFIED**: documented in `pi.dev/docs/latest`, fetched 2026-05-11.
> - **ASSUMED**: not in the docs but inferred from the surrounding API surface; flagged for verification during M1.
> - **OPEN**: neither verified nor assumed; needs a Pi docs read or an SDK type-check.

### 5.1 Package namespace and dependencies

**VERIFIED.** Pi packages live under `@earendil-works/`:

- `@earendil-works/pi-coding-agent` — main package; the CLI binary and the SDK entrypoint
- `@earendil-works/pi-ai` — AI/provider abstraction primitives
- `@earendil-works/pi-agent-core` — agent loop and orchestration internals
- `@earendil-works/pi-tui` — terminal UI components (we do not consume this directly in v3 outside of optional CLI tinkering)

**Peer-dependency policy** (per Pi docs): SWT v3 lists Pi packages as `"peerDependencies": "*"` rather than direct dependencies. Pi's docs state this avoids version conflicts when SWT is installed alongside Pi itself. The exception is `packages/runtime/` which lists `@earendil-works/pi-coding-agent` as both a runtime dep and a peer dep (a known npm pattern for adapter packages).

**Typebox** is a transitive concern: Pi tool definitions use `@sinclair/typebox` for parameter schemas. SWT v3 lists `typebox` as a runtime dep in `packages/runtime/` where custom tools are defined.

### 5.2 SDK entrypoints

**VERIFIED.** The SDK exports these factories and run modes:

```ts
import {
  createAgentSession,
  createAgentSessionRuntime,
  InteractiveMode,
  runPrintMode,
  runRpcMode,
} from '@earendil-works/pi-coding-agent';

// Factory: returns an AgentSession (subscribe/prompt/abort/...).
createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;

// Factory: returns a Runtime wrapper for run-mode entry points.
createAgentSessionRuntime(
  factory: CreateAgentSessionRuntimeFactory,
  options: RuntimeOptions,
): Promise<AgentSessionRuntime>;

// Run modes:
class InteractiveMode {
  constructor(runtime: AgentSessionRuntime, options: { /* initial state */ });
  run(): Promise<void>;
}
function runPrintMode(runtime: AgentSessionRuntime, options: { mode: 'text'; initialMessage: string; initialImages: ImageContent[]; messages: string[]; }): Promise<void>;
function runRpcMode(runtime: AgentSessionRuntime): Promise<void>;
```

**SWT v3 usage pattern:**

- **CLI verbs** (`swt vibe`, `swt status`, etc.) → use `runPrintMode` when they need an LLM round-trip; otherwise no Pi involvement.
- **`swt dashboard`** → uses `createAgentSession` directly, subscribed via SSE.
- **`swt rpc`** (new) → delegates to `runRpcMode`, exposing Pi's RPC surface unchanged but under the `swt` binary name.
- **Subagent workers** → use `createAgentSession({cwd: worktreePath, ...})` per task.

### 5.3 The `AgentSession` interface

**VERIFIED.** The full interface (verbatim from docs):

```ts
interface AgentSession {
  prompt(text: string, options?: PromptOptions): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;

  sessionFile: string | undefined;
  sessionId: string;

  setModel(model: Model): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  cycleModel(): Promise<ModelCycleResult | undefined>;
  cycleThinkingLevel(): ThinkingLevel | undefined;

  agent: Agent;
  model: Model | undefined;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];
  isStreaming: boolean;

  navigateTree(targetId: string, options?: NavigateOptions): Promise<{ editorText?: string; cancelled: boolean }>;
  compact(customInstructions?: string): Promise<CompactionResult>;
  abortCompaction(): void;
  abort(): Promise<void>;
  dispose(): void;
}
```

**SWT v3 wraps this in `packages/runtime/src/session.ts`:**

```ts
// packages/runtime/src/session.ts (sketch)
import { createAgentSession, type AgentSession } from '@earendil-works/pi-coding-agent';
import type { SwtSession, SwtSessionOptions, SwtEvent } from '@swt-labs/shared';

export async function createSession(opts: SwtSessionOptions): Promise<SwtSession> {
  const pi = await createAgentSession({
    cwd: opts.cwd,
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
    sessionManager: opts.ephemeral ? SessionManager.inMemory() : SessionManager.create(opts.cwd),
    tools: opts.tools,
  });
  return wrapSession(pi, opts);
}
```

The `wrapSession` function adds:

- Token-meter event normalization (provider events → `SwtEvent.tokenUsage`)
- Cost calculation per turn (using `ProviderModelConfig.cost`)
- Cache-hit detection (provider-shim-specific)
- Lifecycle journaling (every event also appended to `.swt-planning/journal/`)
- Abort signal threading (orchestrator's `AbortController` → `pi.abort()`)

### 5.4 The Extension API vs raw SDK

**VERIFIED.** Pi exposes an Extension API that runs *inside* a Pi session and can register tools, providers, hooks, commands, message renderers, etc. SWT v3 uses both:

- **Raw SDK** for the orchestrator-side: `createAgentSession`, `subscribe`, `prompt`, `abort`, etc. Used in `packages/runtime/src/session.ts`.
- **Extensions** for in-session customization: provider registration (where Pi's defaults need overrides), custom tools (the SWT result protocol — see §9.4), and hooks (`before_agent_start`, `tool_call`, `agent_end`).

**Extension factory shape (verified):**

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';

export default function (pi: ExtensionAPI) {
  pi.on('agent_end', (event, ctx) => {
    // emit task result, append journal entry, signal worktree harvester
  });

  pi.registerTool({
    name: 'swt_report_result',
    label: 'Report task result',
    description: 'Persist the task result envelope for the worktree harvester.',
    parameters: Type.Object({
      status: Type.Union([Type.Literal('success'), Type.Literal('failed'), Type.Literal('partial')]),
      summary: Type.String({ maxLength: 4096 }),
      artefacts: Type.Array(Type.String()),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // `appendEntry` is on the ExtensionAPI (pi) — capture in closure;
      // `ctx` is ExtensionContext and does NOT expose appendEntry.
      pi.appendEntry('swt-task-result', params);
      return {
        content: [{ type: 'text', text: `Recorded ${params.status}` }],
        details: params,
        terminate: true,
      };
    },
  });

  pi.registerProvider('anthropic-overrides', {
    // override Pi's default Anthropic config where we need stricter cache-control placement
  });
}
```

> **API boundary (load-bearing):** `appendEntry`, `registerTool`, `registerProvider`, `on(...)`, and friends live on the `ExtensionAPI` (the `pi` argument the factory receives). The `ExtensionContext` (`ctx`) passed to event handlers and tool `execute` callbacks is **read-only** for session entries — it exposes `sessionManager.getEntries()`, `cwd`, `ui`, `signal`, `compact()`, etc., but not `appendEntry`. Capture `pi` in closure when you need to write.

**SWT v3 extensions live in:** `packages/runtime/src/extensions/`. Loaded at session creation by passing the extension paths through the resource loader (Pi's `DefaultResourceLoader` supports `extensionFactories` and `additionalExtensionPaths`).

### 5.5 Event stream (15 events + delta types)

**VERIFIED.** The `AgentSessionEvent` discriminated union (full list):

```ts
type AgentSessionEvent =
  | { type: 'message_update'; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: 'message_start'; message: AgentMessage }
  | { type: 'message_end'; message: AgentMessage }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AgentMessage; toolResults: unknown }
  | { type: 'queue_update'; steering: unknown; followUp: unknown }
  | { type: 'compaction_start' }
  | { type: 'compaction_end' }
  | { type: 'auto_retry_start'; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string };
```

**AssistantMessageEvent deltas (VERIFIED):**

`text_start`, `text_delta`, `text_end`, `thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, `error`.

**SWT v3 normalization** (in `packages/runtime/src/events.ts`):

```ts
// SwtEvent — what the rest of SWT consumes
type SwtEvent =
  | { type: 'TASK_STARTED'; taskId: string }
  | { type: 'TASK_TOKEN_USAGE'; taskId: string; input: number; output: number; cacheRead: number; cacheWrite: number }
  | { type: 'TASK_TOOL_CALL'; taskId: string; toolName: string; args: unknown }
  | { type: 'TASK_TOOL_RESULT'; taskId: string; toolName: string; isError: boolean }
  | { type: 'TASK_MESSAGE'; taskId: string; role: 'assistant' | 'user' | 'toolResult'; content: string }
  | { type: 'TASK_RETRY'; taskId: string; attempt: number; maxAttempts: number; reason: string }
  | { type: 'TASK_COMPLETED'; taskId: string; result: TaskResult }
  | { type: 'TASK_FAILED'; taskId: string; error: SwtError };
```

The mapping is deterministic; tests assert byte-identical token counts on cassette replay.

### 5.6 Session file format (v3 schema)

**VERIFIED.** Pi session files are JSONL. First line is the header:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"2026-05-11T14:00:00.000Z","cwd":"/path/to/project"}
```

Entry types (all share `{type, id, parentId, timestamp}`):

- `message` — conversation message (UserMessage / AssistantMessage / ToolResultMessage / etc.)
- `model_change` — `{provider, modelId}`
- `thinking_level_change` — `{thinkingLevel}`
- `compaction` — `{summary, firstKeptEntryId, tokensBefore}`
- `branch_summary` — `{fromId, summary}`
- `custom` — `{customType, data}` — extension state (NOT in LLM context)
- `custom_message` — `{customType, content, display}` — extension message IN LLM context
- `label` — `{targetId, label}` — user bookmarks
- `session_info` — `{name}` — session display name

**SWT v3 stores task results as `custom` entries** with `customType: "swt-task-result"` (see §9.4).

**Session storage:** `~/.pi/agent/sessions/`, organized by working-directory hash. v3 does not change this. The `--session-dir` flag lets the orchestrator point worktree sessions into a worktree-local directory (`.swt-planning/parallel/wt-<id>/.pi-session/`) for forensics.

### 5.7 Provider registration (verified)

**VERIFIED.** Custom and overridden providers register via `pi.registerProvider(name, config)`. The `ProviderConfig` shape:

```ts
interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;            // literal | "ENV_VAR" | "!shell-command"
  api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
  models?: ProviderModelConfig[];   // when set, REPLACES Pi's defaults for this provider
  headers?: Record<string, string>;
  authHeader?: boolean;       // adds `Authorization: Bearer ${apiKey}`
  oauth?: OAuthConfig;        // see §5.7.1
  streamSimple?: StreamSimpleFn;  // custom streaming for non-standard providers
}

interface ProviderModelConfig {
  id: string;                 // model ID passed to the provider
  name?: string;              // human display
  reasoning?: boolean;        // extended thinking support
  input?: Array<'text' | 'image'>;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };  // per MTok
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<ThinkingLevel, string | null>;  // null = unsupported, omit = default
  compat?: {
    thinkingFormat?: 'openai' | 'deepseek' | 'qwen';
    maxTokensField?: 'max_tokens' | 'max_completion_tokens';
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    supportsUsageInStreaming?: boolean;
    supportsStore?: boolean;
    supportsStrictMode?: boolean;
    supportsLongCacheRetention?: boolean;
  };
}
```

#### 5.7.1 OAuth config

```ts
interface OAuthConfig {
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
  modifyModels?(models: ProviderModelConfig[], credentials: OAuthCredentials): ProviderModelConfig[];
}

interface OAuthLoginCallbacks {
  onAuth(args: { url: string }): Promise<unknown>;          // browser redirect flow
  onDeviceCode(args: { userCode: string; verificationUri: string }): Promise<unknown>;
  onPrompt(args: { message: string }): Promise<unknown>;
}

interface OAuthCredentials { refresh: string; access: string; expires: number }
```

OAuth credentials persist in `~/.pi/agent/auth.json` automatically.

#### 5.7.2 SWT v3 use of provider registration

SWT v3 does **not** rewrite Pi's built-in providers. It registers **override extensions** in `packages/runtime/src/extensions/provider-overrides.ts` for cases where Pi's defaults are wrong for SWT's workload:

- **Anthropic:** populate `thinkingLevelMap` so Pi's `xhigh` resolves to Anthropic's `"high"` extended-thinking string (Anthropic's API has fewer steps than Pi's enum). This is the provider hop of the canonical reasoning chain in §7.1.1.
- **OpenAI:** ensure `compat.maxTokensField = 'max_completion_tokens'` for gpt-5+ models; populate `thinkingLevelMap` to surface OpenAI's `reasoning_effort` field.
- **OpenRouter:** override per-upstream-model cost where OpenRouter reports differ from our measurements; set `compat.thinkingFormat = 'deepseek'` for the DeepSeek family.

The full overrides table lives in `runtime/providers/quirks.json` (a JSON config consumed by the extension, NOT a hand-written shim per provider). See §7.5 for the canonical example.

### 5.8 Tool model

**VERIFIED.** Three ways to provide tools:

1. **Pi's built-in tool factories** (`createCodingTools(cwd)`, `createReadTool(cwd)`, `createBashTool(cwd)`, `createEditTool(cwd)`, `createWriteTool(cwd)`, `createGrepTool(cwd)`, `createFindTool(cwd)`, `createLsTool(cwd)`, `createReadOnlyTools(cwd)`). Use for default tools; the `cwd` parameter scopes the tool to the worktree.

2. **`defineTool` from the SDK** — for custom tools instantiated at session creation:
   ```ts
   import { defineTool } from '@earendil-works/pi-coding-agent';
   import { Type } from '@sinclair/typebox';

   const myTool = defineTool({
     name: 'my_tool',
     label: 'My Tool',
     description: 'Does the thing.',
     parameters: Type.Object({ x: Type.Number() }),
     async execute(toolCallId, params) {
       return { content: [{ type: 'text', text: String(params.x) }], details: { x: params.x } };
     },
   });
   ```

3. **`pi.registerTool` via Extension** — for tools that need session context (`ctx.sessionManager`, `ctx.cwd`, `ctx.ui`, etc.) AND that need to write durable session entries (via the closure-captured `pi.appendEntry`; see §5.4 boundary note), use Extension registration. SWT's `swt_report_result` tool (§9.4) goes this route.

**Tool result shape:**

```ts
interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; ... }>;
  details?: object;
  terminate?: boolean;        // hint: skip the follow-up LLM call
}
```

Throw an error from `execute` to mark the call as failed; the LLM receives the error message as the tool result.

### 5.9 Compaction vs cache (clarifying §1.5 strategy)

**VERIFIED.** Pi's compaction (`/docs/latest/compaction`) is conversation summarization:

```
trigger: contextTokens > contextWindow - reserveTokens
walk backwards until keepRecentTokens
generate summary via LLM, append CompactionEntry, reload session
```

Defaults: `reserveTokens = 16384`, `keepRecentTokens = 20000`. Both are settings-tunable.

**Pi does not expose `cache_control` at the session level.** Anthropic's `cache_control` and OpenAI's prompt caching are provider-level features, surfaced through:

- `ProviderModelConfig.cost.{cacheRead, cacheWrite}` — per-model rates
- `compat.supportsLongCacheRetention` — flag for extended TTL
- The provider's `api` type — `'anthropic-messages'` triggers Anthropic's cache_control breakpoint handling

**SWT v3 splits these concerns:**

- **Cache discipline (§8.2)** — provider-shim work in `packages/runtime/src/cache/`. The buildPrompt function (§8.3) emits deterministic prompts with stable ordering, and provider-specific cache-control breakpoints are inserted by `packages/runtime/src/providers/anthropic-cache.ts` (one of three or four such files; OpenAI cache is implicit per their auto-cache, Bedrock has its own rules).
- **Compaction (§8.5)** — Pi-native. SWT trusts Pi's compaction defaults but tunes `keepRecentTokens` and `reserveTokens` per role (Scout: short keep, Architect: longer keep, Debugger: very long keep).

**The "≥70% cache hit ratio" target** is achieved by:

1. Deterministic prompt prefix (same system prompt across role invocations)
2. Stable artefact ordering (PROJECT.md → REQUIREMENTS.md → STATE.md → PHASE.md → task brief)
3. Anthropic `cache_control: { type: 'ephemeral' }` breakpoint after the artefact block, before the task-specific content
4. Min-token threshold per breakpoint (Anthropic requires ≥1024 tokens between breakpoints)
5. Measurement via `SwtEvent.TASK_TOKEN_USAGE`'s `cacheRead` field

### 5.10 RPC protocol

**VERIFIED.** Pi RPC mode uses JSONL over stdin/stdout. Critical implementation notes:

- **Framing: `\n` only.** Node's `readline` is incompatible because it splits on Unicode separators U+2028/U+2029 that can appear inside JSON strings.
- Commands: `{id?, type, ...}`; the optional `id` correlates with the response.
- Responses: `{id, type: 'response', command, success, data?, error?}`. Parse errors use `command: 'parse'`.
- Events: stream asynchronously to stdout with no `id` field.

**Commands (partial, verified):** `prompt`, `steer`, `follow_up`, `abort`, `bash`, `set_model`, `get_available_models`, `set_thinking_level`, `get_state`, `get_messages`, `compact`, `set_auto_compaction`, `new_session`, `switch_session`, `fork`, `clone`.

**Streaming behavior** for `prompt` (verified):
- Without `streamingBehavior`: error if a stream is in progress.
- `streamingBehavior: 'steer'`: queue; deliver after current tool execution finishes.
- `streamingBehavior: 'followUp'`: queue; deliver only when agent stops.

**Bash command lifecycle (verified):** the `bash` RPC command executes immediately and returns `BashResult`. Internally, a `BashExecutionMessage` is created but does NOT emit an event. Output is included in LLM context on the **next prompt**, not immediately. (This is the basis for SWT's `verification_commands` static-check ladder running zero-token.)

**SWT v3 exposes Pi RPC via `swt rpc`** — a new CLI verb in M2 that delegates to `runRpcMode(runtime)`. No protocol modification.

### 5.11 CLI flag reference (Pi)

**VERIFIED.** Pi CLI flags SWT v3 may pass-through or wrap:

| Flag | Purpose | SWT v3 use |
|---|---|---|
| (default) | Interactive TUI | Hidden in SWT — not exposed |
| `-p, --print` | Print response and exit | Used by `swt vibe` non-interactive mode |
| `--mode json` | Output events as JSON lines | Used by `swt dashboard` to consume Pi events |
| `--mode rpc` | RPC mode | Used by `swt rpc` |
| `--provider <name>` | Provider override | Mapped from role→tier in `runtime/role-resolver.ts` |
| `--model <pattern>` | Model pattern; `provider/id:<thinking>` syntax | Mapped from role→tier |
| `--api-key <key>` | API key override | Used by orchestrator when temporarily routing through a non-default provider |
| `--thinking <level>` | `off / minimal / low / medium / high / xhigh` | Mapped from role's tier |
| `-c, --continue` | Continue most recent session | Used by `swt vibe --resume` |
| `-r, --resume` | Browse and select session | Used by `swt dashboard` SPA session picker |
| `--session <path\|id>` | Specific session | Used by worktree dispatcher to attach to existing sessions |
| `--no-session` | Ephemeral session | DEFAULT for all subagent dispatches (Principle 7) |
| `--session-dir <dir>` | Custom session storage | Used by worktree dispatcher to scope sessions per worktree |
| `--models <patterns>` | Comma-separated for Ctrl+P cycling | Not exposed (SWT picks models, not the user mid-task) |

### 5.12 Settings & Auth

**VERIFIED.** Settings live in `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project, overrides). Auth lives in `~/.pi/agent/auth.json` (created with `0600` permissions).

SWT v3 reads but does NOT write `.pi/settings.json` or `auth.json`. Configuration that affects SWT alone lives in `.swt-planning/config.json`; configuration that affects Pi alone lives in `.pi/settings.json` and is the user's responsibility (with `swt doctor` validation).

The boundary is enforced: any SWT code that tries to write `.pi/` or `~/.pi/` fails CI via a custom ESLint rule.

### 5.13 Symbols flagged for M1 verification

These symbols were referenced in TDD.md but are NOT verified against `pi.dev/docs/latest`:

| Symbol | TDD.md location | Status | M1 verification action |
|---|---|---|---|
| `shouldStopAfterTurn` | TDD.md§11 M3 gate | **NOT FOUND** | Confirmed absent. Replace with Extension `agent_end` hook + tool `{terminate: true}`. ADR-002. |
| `report_result` (built-in tool) | TDD.md§11 M3 deliverables | **NOT FOUND** | Confirmed absent. Implement as `swt_report_result` via `pi.registerTool` (§9.4). ADR-003. |
| `cache_control` at session level | TDD.md§7 | **NOT FOUND** at Pi level | Confirmed: lives at provider shim. §8.2 + ADR-004. |
| `createSession` (bare, no `Agent` prefix) | TDD.md§5 sketches | **NOT FOUND** (actual: `createAgentSession`) | Wrapper in `runtime/src/session.ts` exposes a SWT-local `createSession` that calls Pi's `createAgentSession`. |
| `report_result` schema (`{task_id, status, files_changed, summary}`) | TDD.md§8 | n/a (implied) | Replace with our schema in `packages/shared/schemas/task-result.ts` (§9.4). |

If during M1 any **VERIFIED** symbol turns out to be wrong (e.g., Pi changes its docs), the discovering PR MUST update this section in the same commit.

---

## 6. Module / Package Layout (v3 final)

> **Δ from TDD.md§5:** TDD.md proposed 7 packages; TDD2 confirms 7 packages with one rename (`core` is sub-packaged internally) and clarifies the v2→v3 migration table. The root binary path stays at `./dist/cli.mjs` to preserve `npx swt` muscle memory.

### 6.1 Package tree

```
packages/
├── core/                                 # Layer 3 — methodology (preserved + cleaned)
│   ├── src/
│   │   ├── methodology/                  # was @swt-labs/methodology
│   │   │   ├── audit/
│   │   │   ├── discussion/
│   │   │   ├── memory/
│   │   │   ├── profiles/
│   │   │   ├── prompt-builder/
│   │   │   ├── qa/
│   │   │   ├── state/
│   │   │   └── vibe/
│   │   ├── artefacts/                    # was @swt-labs/artifacts (renamed to British)
│   │   │   ├── atomic-write.ts
│   │   │   ├── frontmatter.ts
│   │   │   ├── bootstrap/
│   │   │   ├── milestones/
│   │   │   ├── phases/
│   │   │   ├── qa/
│   │   │   ├── roadmap/
│   │   │   ├── schemas/
│   │   │   └── state/
│   │   ├── verification/                 # was @swt-labs/verification
│   │   │   ├── checks/
│   │   │   ├── guards/
│   │   │   ├── circuit-breaker.ts
│   │   │   ├── runner.ts
│   │   │   └── traceability.ts
│   │   ├── telemetry/                    # was @swt-labs/telemetry
│   │   │   ├── anonymous-id.ts
│   │   │   ├── client.ts
│   │   │   ├── events.ts
│   │   │   ├── http-sender.ts
│   │   │   ├── sanitize.ts
│   │   │   └── sender.ts
│   │   ├── abstractions/                 # was @swt-labs/core/abstractions
│   │   │   ├── HookHost.ts
│   │   │   ├── MemoryStore.ts
│   │   │   ├── PermissionGate.ts
│   │   │   ├── Prompter.ts
│   │   │   └── index.ts
│   │   ├── handoff/                      # was @swt-labs/core/handoff
│   │   ├── scaffold/                     # was @swt-labs/core/scaffold
│   │   └── index.ts                      # public re-exports
│   ├── test/
│   └── package.json
│
├── runtime/                              # Layer 1 — Pi adapter (NEW in v3)
│   ├── src/
│   │   ├── session.ts                    # createSession() — thin wrapper around Pi
│   │   ├── tools.ts                      # tool factories scoped to a cwd
│   │   ├── events.ts                     # Pi event → SwtEvent mapping
│   │   ├── cache/
│   │   │   ├── breakpoints.ts            # provider-agnostic cache-control insertion
│   │   │   ├── anthropic-cache.ts        # Anthropic cache_control specifics
│   │   │   ├── openai-cache.ts           # OpenAI implicit prompt cache observers
│   │   │   └── bedrock-cache.ts          # Bedrock Claude cache (auto-enabled per Pi docs)
│   │   ├── meter/
│   │   │   ├── token-meter.ts            # input/output/cacheRead/cacheWrite aggregation
│   │   │   ├── cost-aggregator.ts        # multiplies token counts × ProviderModelConfig.cost
│   │   │   └── budget-gate.ts            # global + per-role budget enforcement
│   │   ├── providers/
│   │   │   ├── quirks.json               # per-provider overrides (no per-provider .ts files)
│   │   │   ├── role-resolver.ts          # role → tier → concrete model
│   │   │   └── failover.ts               # retry budget + fallback chain
│   │   └── extensions/
│   │       ├── result-protocol.ts        # registers swt_report_result tool
│   │       ├── provider-overrides.ts     # applies quirks.json
│   │       └── journal.ts                # mirrors Pi events into .swt-planning/journal/
│   ├── test/
│   └── package.json                      # peerDep: @earendil-works/pi-coding-agent ^*
│
├── orchestration/                        # Layer 2 — dispatcher and DAG (NEW)
│   ├── src/
│   │   ├── worktree-manager.ts           # git worktree lifecycle
│   │   ├── dispatcher.ts                 # spawns subagents, harvests results
│   │   ├── dag-resolver.ts               # depends_on → parallel batches
│   │   ├── claim-registry.ts             # file-claim conflict prevention
│   │   ├── result-protocol.ts            # parses swt_report_result outputs
│   │   ├── lock-files.ts                 # PID liveness + crash recovery
│   │   └── journal/
│   │       ├── append.ts                 # journal writer
│   │       └── replay.ts                 # crash-recovery replay
│   ├── test/
│   └── package.json
│
├── dashboard/                            # Layer 4 — Hono + Solid (preserved + extended)
│   ├── src/
│   │   ├── server/                       # see §3.2.5 file inventory
│   │   ├── client/                       # Solid SPA
│   │   └── shared/                       # protocol types shared with client
│   ├── test/
│   └── package.json
│
├── cli/                                  # Layer 5 — verb surface (preserved + decomposed)
│   ├── src/
│   │   ├── argv.ts
│   │   ├── commands/
│   │   │   ├── (10 v2 verbs preserved with rewired internals)
│   │   │   ├── (15 ex-stub verbs cashed in per §3.2.4 disposition table: plan, qa, map, debug, archive,
│   │   │   │   pause, audit, assumptions, research, phase, todo, skills, whats-new, uninstall, worktree, lease)
│   │   │   ├── migrate.ts                # NEW: swt migrate --to=v3
│   │   │   ├── rpc.ts                    # NEW: swt rpc (delegates to Pi runRpcMode)
│   │   │   ├── bench.ts                  # NEW: swt bench (TPAC reference)
│   │   │   └── cleanup.ts                # NEW: swt cleanup (worktree retention)
│   │   ├── exit-codes.ts
│   │   ├── help.ts
│   │   ├── lib/
│   │   ├── lifecycle/
│   │   ├── main.ts
│   │   ├── prompters/
│   │   ├── router.ts
│   │   └── watch/
│   ├── test/
│   └── package.json
│
├── shared/                               # cross-package types + utils (NEW)
│   ├── src/
│   │   ├── types/                        # SwtSession, SwtEvent, TaskResult, Role
│   │   ├── schemas/                      # Zod schemas — single source of truth
│   │   │   ├── task-result.ts            # the result-protocol schema (§9.4)
│   │   │   ├── plan.ts                   # phase plan schema
│   │   │   ├── claim.ts                  # file-claim schema
│   │   │   ├── budget.ts                 # budget config + state schema
│   │   │   └── ...
│   │   └── util/
│   ├── test/
│   └── package.json
│
└── test-utils/                           # test fixtures + cassette infra (private)
    ├── src/
    │   ├── cassettes/                    # recorded LLM responses (see §14.7)
    │   ├── fixtures/                     # synthetic projects, milestones, plans
    │   ├── mocks/                        # mock implementations of runtime interfaces
    │   └── golden/                       # reference artefact bundles
    ├── test/
    └── package.json                      # private: true; not published
```

### 6.2 Public surface per package

The exported npm symbols and intra-monorepo entry points:

| Package | Published as | Public exports | Intra-monorepo consumers |
|---|---|---|---|
| `@swt-labs/core` | yes (v3.0.0+) | `methodology`, `artefacts`, `verification`, `telemetry`, `abstractions`, `handoff`, `scaffold` | `dashboard`, `cli`, `orchestration` |
| `@swt-labs/runtime` | yes (v3.0.0+) | `createSession`, `createTools`, `SwtEvent`, `TaskResult`, `tokenMeter`, `budgetGate` | `orchestration`, `cli` |
| `@swt-labs/orchestration` | yes (v3.0.0+) | `Dispatcher`, `WorktreeManager`, `DagResolver`, `ClaimRegistry` | `dashboard`, `cli` |
| `@swt-labs/dashboard` | yes (v3.0.0+) | `startDashboard(options)`, `ApiSchemas` | `cli` (the `swt dashboard` verb) |
| `@swt-labs/cli` | no (private) | binary only (`swt`) | (entrypoint) |
| `@swt-labs/shared` | yes (v3.0.0+) | types + zod schemas only | all packages |
| `@swt-labs/test-utils` | no (private) | cassette + mock helpers | all `test/` dirs |

The `@swt-labs/cli` package is **not published** because the root `package.json` IS the published binary (`stop-wasting-tokens` package). The CLI package exists as an internal organizational unit; the root build (`tsup`) bundles it.

### 6.3 Internal interfaces (layer boundaries as TypeScript types)

#### 6.3.1 Layer 1 ↔ Layer 2 — `SwtSession`

```ts
// packages/shared/src/types/session.ts
export interface SwtSession {
  id: string;
  taskId: string;
  cwd: string;
  model: string;
  tier: Tier;
  thinkingLevel: ThinkingLevel;

  prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: SwtEvent) => void): () => void;
  dispose(): void;
}

export type Tier = 'cheap-fast' | 'balanced' | 'quality' | 'reasoning';
```

The orchestrator never imports from `@earendil-works/*`. It receives `SwtSession` from the runtime adapter and consumes `SwtEvent`.

#### 6.3.2 Layer 2 ↔ Layer 3 — `Dispatcher`

```ts
// packages/shared/src/types/dispatcher.ts
export interface Dispatcher {
  dispatch(task: TaskBrief): Promise<TaskResult>;
  dispatchBatch(tasks: TaskBrief[], opts?: { maxParallel?: number }): Promise<TaskResult[]>;
}

export interface TaskBrief {
  taskId: string;
  role: Role;
  cwd: string;                  // worktree path
  claims: string[];             // file paths this task may touch
  promptContext: PromptContext; // built by methodology's prompt-builder
  budgetCeilingTokens?: number;
  tier?: Tier;                  // override role's default tier
}

export type Role = 'scout' | 'architect' | 'lead' | 'dev' | 'qa' | 'debugger';
```

The methodology produces `TaskBrief`s; the dispatcher returns `TaskResult`s. The methodology has no opinion on how the task is dispatched (worktree, parallelism, retry).

#### 6.3.3 Layer 3 ↔ Layer 4 — `MethodologyAgent`

```ts
// packages/shared/src/types/methodology.ts
export interface MethodologyAgent {
  run(input: { goal: string; phase: PhaseRef; resume?: boolean }): AsyncIterable<MethodologyEvent>;
  pause(): Promise<void>;
  abort(): Promise<void>;
}

export type MethodologyEvent =
  | { type: 'PHASE_STARTED'; phase: PhaseRef }
  | { type: 'PLAN_PROPOSED'; plan: Plan }
  | { type: 'TASK_DISPATCHED'; task: TaskBrief }
  | { type: 'TASK_COMPLETED'; result: TaskResult }
  | { type: 'PHASE_COMPLETED'; phase: PhaseRef; summary: PhaseSummary }
  | { type: 'AWAITING_INPUT'; prompt: string };
```

The dashboard's `vibe/methodology-agent.ts` consumes this interface; the methodology produces it. The dashboard never imports methodology internals — only the typed event stream.

#### 6.3.4 Layer 4 ↔ Layer 5 — Hono `App`

The CLI's `swt dashboard` verb instantiates the Hono app and binds it to `127.0.0.1:<port>`. The verb is small (~50 lines); all dashboard logic is in `packages/dashboard/`. No fan-in from the CLI other than command-line argv → dashboard options.

### 6.4 Build, test, release tooling

| Concern | Tool | v3 notes |
|---|---|---|
| Bundler | `tsup ^8.3.0` | One bundle per package; root bundle is the published `swt` binary. |
| Test | `vitest ^2.1.3` | Per-package config extending root `vitest.config.ts`. See §14. |
| Lint | `eslint ^9.13.0` (flat config) | Adds `import/no-restricted-paths` rule (§4.3). |
| Format | `prettier ^3.3.3` | No change from v2. |
| Release | `@changesets/cli ^2.27.9` | No change from v2. |
| Lockfile | `pnpm-lock.yaml` | Frozen in CI. Regenerated in M1 PR-01 after Pi deps land. |
| Bundle-size budgets | `scripts/check-bundle-size.mjs` | New budgets per package; see §15.7. |
| Offline check | `scripts/check-offline.mjs` | Preserved (asserts dashboard SPA boot without network). |
| Docs generation | `scripts/docs-gen.ts` | Extended in M6 to include the public benchmark report. |
| Vale | `vale.yml` workflow + `.vale.ini` | Preserved; new style for ADR documents. |

### 6.5 Binary entrypoint

The published `swt` binary continues to be at `./dist/cli.mjs` (relative to the package root). This preserves `npx swt` and any tooling that grepped for the path in v2.x. The CLI package internally lives at `packages/cli/`; tsup bundles `packages/cli/src/main.ts` into `./dist/cli.mjs` at the root.

TDD.md§5.2's claim that the binary moves to `packages/cli/bin/swt.mjs` is **not adopted** — preserving the v2 path has zero downside and avoids churn for downstream consumers.

### 6.6 v2 → v3 package migration table

| v2 package | v3 location | Notes |
|---|---|---|
| `stop-wasting-tokens` (root) | `stop-wasting-tokens` (root) | **The published binary.** v3 drops `@swt-labs/{codex,claude-code,ollama}-driver` from `dependencies`; adds `@earendil-works/pi-coding-agent` and `pi-ai` to `peerDependencies`; binary path stays at `./dist/cli.mjs`; tsup-bundled from `packages/cli/src/main.ts`. |
| `@swt-labs/core` (abstractions/) | `@swt-labs/core/abstractions/` | Sub-export |
| `@swt-labs/core` (types/) | `@swt-labs/shared/types/` | Migrated to shared |
| `@swt-labs/core` (handoff/, scaffold/, config/, errors/) | `@swt-labs/core/{handoff,scaffold,config,errors}/` | Sub-exports |
| `@swt-labs/artifacts` | `@swt-labs/core/artefacts/` | Renamed (British) |
| `@swt-labs/methodology` | `@swt-labs/core/methodology/` | Sub-export |
| `@swt-labs/verification` | `@swt-labs/core/verification/` | Sub-export |
| `@swt-labs/telemetry` | `@swt-labs/core/telemetry/` | Sub-export |
| `@swt-labs/dashboard-core` | `@swt-labs/shared/schemas/` | Folded |
| `@swt-labs/cli` | unchanged | |
| `@swt-labs/dashboard` | unchanged | |
| `@swt-labs/codex-driver` | **deleted** | |
| `@swt-labs/claude-code-driver` | **deleted** | |
| `@swt-labs/ollama-driver` | **deleted** | |
| (new) | `@swt-labs/runtime` | Pi adapter |
| (new) | `@swt-labs/orchestration` | Worktree + DAG |
| (new) | `@swt-labs/shared` | types + schemas |
| (new) | `@swt-labs/test-utils` | private, cassettes |

**Re-export shim policy:** For one minor cycle (v3.0.x), the old `@swt-labs/artifacts`, `@swt-labs/methodology`, `@swt-labs/verification`, `@swt-labs/telemetry`, `@swt-labs/dashboard-core` are kept as thin re-export packages pointing to the new locations. They are **deleted** in v3.1.0. This gives external consumers one minor version to update imports.

---

## 7. Vendor-Agnostic Provider Abstraction

> **Δ from TDD.md§6:** TDD.md§6 proposed per-provider TypeScript shims (`runtime/providers/anthropic.ts`, `openai.ts`, etc.). TDD2 replaces these with a single `quirks.json` overrides file consumed by one extension, because Pi already supports every provider listed in TDD.md natively. SWT only writes overrides where Pi's defaults don't match SWT's workload.

### 7.1 The capability-tier model

The methodology layer **does not name models**. It names tiers. The runtime layer resolves tier→model based on provider availability and configuration.

| Tier | Use case | Example mapping per provider (illustrative) |
|---|---|---|
| `cheap-fast` | Scout queries, simple completions, classification | Anthropic: Haiku · OpenAI: gpt-5-mini · GLM: glm-5-air |
| `balanced` | Dev tasks, QA verification, Lead coordination | Anthropic: Sonnet · OpenAI: gpt-5 · GLM: glm-5 |
| `quality` | Architect decisions, design trade-offs | Anthropic: Opus · OpenAI: gpt-5-pro · GLM: glm-5-max |
| `reasoning` | Debugger, deep root-cause analysis | Pi `thinkingLevel: 'xhigh'` per-provider mapped (see §7.1.1) — Anthropic: Opus + xhigh · OpenAI: o-series · DeepSeek-R1 |

**Tier mapping is configuration, not code.** The mapping table lives in `~/.swt/tiers.json` (user-customizable) with a built-in default `runtime/providers/default-tiers.json`. Users can override per-project at `.swt-planning/tiers.json`.

#### 7.1.1 The `reasoning` tier and Pi `thinkingLevel` (canonical chain)

The reasoning tier has two indirections that are easy to confuse. The canonical chain — used everywhere in TDD2:

```
SWT tier "reasoning"              role-resolver.ts → constant
        │
        ▼
Pi  thinkingLevel "xhigh"         Pi's enum: off|minimal|low|medium|high|xhigh
        │
        ▼
provider-specific value           via ProviderModelConfig.thinkingLevelMap (in quirks.json)
  Anthropic Opus:    "high"       (Anthropic's API surface for extended thinking)
  OpenAI o-series:   reasoning_effort: "high"
  DeepSeek-R1:       (model-native — no field, just route to R1)
  Gemini 2.5 Pro:    thinkingBudget: "xhigh" (Pi-passthrough)
```

**Rule of thumb:**
- The methodology and orchestrator NEVER speak provider strings. They speak SWT tiers (`reasoning`) and Pi thinkingLevels (`xhigh`).
- The provider boundary (one extension applying `quirks.json`) is the only place provider strings appear.
- `thinkingLevelMap` keys are Pi `ThinkingLevel` values; map values are provider strings (or `null` for unsupported).

**Default tier mapping (illustrative; the shipped file is generated at build time):**

> The model IDs below are illustrative as of May 2026. Pi's docs do **not** enumerate specific model IDs — they document providers and capability fields (`reasoning`, `thinkingLevelMap`, `cost`, `contextWindow`). The actual `runtime/providers/default-tiers.json` is generated by `scripts/gen-default-tiers.mjs` at build time from Pi's runtime provider catalogue, so the table stays current automatically. Hand-overrides live in `~/.swt/tiers.json` or `.swt-planning/tiers.json` per §7.2.


```json
{
  "anthropic": {
    "cheap-fast": "claude-haiku-4-5",
    "balanced": "claude-sonnet-4-6",
    "quality": "claude-opus-4-7",
    "reasoning": "claude-opus-4-7:high"
  },
  "openai": {
    "cheap-fast": "gpt-5-mini",
    "balanced": "gpt-5",
    "quality": "gpt-5-pro",
    "reasoning": "o4"
  },
  "openrouter": {
    "cheap-fast": "moonshotai/kimi-k2-air",
    "balanced": "deepseek/deepseek-v4",
    "quality": "deepseek/deepseek-v4:high",
    "reasoning": "deepseek/deepseek-r1"
  },
  "google": {
    "cheap-fast": "gemini-2.5-flash",
    "balanced": "gemini-2.5-pro",
    "quality": "gemini-2.5-pro:high",
    "reasoning": "gemini-2.5-pro:xhigh"
  }
}
```

(Model IDs above are illustrative for May 2026; the actual default file is generated by `scripts/gen-default-tiers.mjs` from Pi's provider registry at build time.)

### 7.2 Role → tier mapping (default)

| Role | Default tier | Rationale |
|---|---|---|
| Scout | `cheap-fast` | Isolated subagent; returns compressed findings. Cost matters; quality matters less. |
| Architect | `quality` | Isolated; produces plan artefact. One call, high value. |
| Lead | `balanced` | Coordinates; uses many tools. Cost compounds. |
| Dev | `balanced` | Bulk work. Token-volume sensitive. |
| QA | `balanced` (LLM tier) | Static checks first (zero-token); LLM tier only on escalation. |
| Debugger | `reasoning` | Deep root-cause; willing to pay for reasoning. |

**Override rules:**

- `.swt-planning/config.json#roles[role].tier` overrides the default per project.
- A specific task in a plan can declare `tier: 'quality'` to override its role default for that one dispatch.
- The role-resolver logs every override; the dashboard's Tier panel surfaces the running distribution.

### 7.3 Provider router strategies

The `runtime/providers/role-resolver.ts` consults the **router strategy** to choose a provider when a tier has multiple provider candidates available.

**Strategies (configured at `.swt-planning/config.json#router_strategy`):**

| Strategy | Behavior |
|---|---|
| `pinned` | Always use the project's configured `default_provider`. No failover unless explicitly enabled. |
| `round-robin` | Cycle providers per dispatch, weighted by recent success rate. |
| `tier-routed` | Choose the cheapest provider that meets the tier (uses `cost.input + cost.output × expected_ratio`). |
| `cost-optimized` | Like tier-routed but also factors `cacheRead` discount. Aggressive. Recommended for high-volume phases. |
| `quality-pinned-cost-failover` | Use the user's preferred provider; on failure, fall back through a configured cost-sorted list. |

Default strategy: `tier-routed`. The Architect role is hard-pinned to the user's preferred quality provider (no router for one-shot high-value calls).

### 7.4 Fallback chain semantics

When a provider call fails, the failover module decides whether to retry, switch providers, or hard-fail:

| Error class | Behavior | Retry budget |
|---|---|---|
| 5xx from provider | Retry on same provider with exponential backoff | 3 attempts, 1s/3s/9s |
| 429 rate-limit | Wait for `Retry-After` header; if absent, wait 30s | 2 attempts |
| 401/403 auth | Hard-fail, surface to dashboard, request user `/login` | 0 retries |
| Network timeout | Retry on same provider | 2 attempts |
| `auto_retry_*` Pi-level events | Already retrying inside Pi; do not double-retry at runtime | n/a |
| All retries exhausted | Fall back to next provider in strategy's list | 1 cross-provider attempt |
| Cross-provider exhausted | Pause task, mark BLOCKED in journal, notify dashboard | n/a |

The retry budget is **shared** across `runtime/providers/failover.ts` and Pi's built-in `auto_retry_*` mechanism. The failover module subscribes to `auto_retry_start` / `auto_retry_end` events and counts those as Pi-level retries.

**Per-task budget cap:** A single `TaskBrief` cannot consume more than `task.budgetCeilingTokens` regardless of retries; if exhausted, the task fails fast.

### 7.5 Per-provider quirks (single overrides file)

Instead of one TypeScript file per provider (TDD.md's approach), v3 uses a single JSON file consumed by one extension:

```jsonc
// packages/runtime/src/providers/quirks.json
//
// thinkingLevelMap keys are Pi ThinkingLevel values
// ('off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh').
// Values are provider-specific strings, or null for "unsupported".
// SWT's "reasoning" tier resolves to Pi `xhigh` upstream (see §7.1.1);
// this file only handles the Pi-thinkingLevel → provider-string hop.
{
  "anthropic": {
    "models": {
      "claude-opus-4-7": {
        "thinkingLevelMap": {
          "off":     null,
          "minimal": null,
          "low":     null,
          "medium":  "low",
          "high":    "medium",
          "xhigh":   "high"     // Anthropic's API caps extended thinking at "high"
        }
      }
    },
    "compat": {
      "supportsLongCacheRetention": true
    }
  },
  "openai": {
    "models": {
      "gpt-5*": {
        "compat": {
          "maxTokensField": "max_completion_tokens",
          "supportsDeveloperRole": true,
          "supportsReasoningEffort": true
        },
        "thinkingLevelMap": {
          "off":     null,
          "minimal": "minimal",
          "low":     "low",
          "medium":  "medium",
          "high":    "high",
          "xhigh":   "high"     // gpt-5 family tops out at "high" reasoning_effort
        }
      }
    }
  },
  "openrouter": {
    "models": {
      "deepseek/*": {
        "compat": {
          "thinkingFormat": "deepseek"
        }
      }
    }
  }
}
```

The `provider-overrides.ts` extension applies these via `pi.registerProvider` at session creation. **Adding a new provider does NOT require new code** — only a quirks-file entry, if Pi's defaults need adjustment.

### 7.6 Token cost calculation

Token cost = Σ over events of:

```
cost_event = (event.input * model.cost.input
            + event.output * model.cost.output
            + event.cacheRead * model.cost.cacheRead
            + event.cacheWrite * model.cost.cacheWrite) / 1_000_000
```

Where `event.input`, `event.output`, `event.cacheRead`, `event.cacheWrite` are token counts and `model.cost.*` are per-MTok rates from `ProviderModelConfig.cost`.

**Cost aggregation lives in `runtime/meter/cost-aggregator.ts`.** It subscribes to `SwtEvent.TASK_TOKEN_USAGE` and emits `SwtEvent.TASK_COST_UPDATED` with cumulative-per-task and cumulative-per-milestone fields. The dashboard's Cost panel (M5) consumes the milestone-level stream.

**Per-cassette invariant:** in tests, replaying the same cassette produces identical cost figures to the original recording, byte-for-byte. The cost-aggregator is deterministic given the same events.

---

## 8. Token Optimization Architecture

> **Δ from TDD.md§7:** TDD.md§7 treated `cache_control` as a Pi-level concern with insertion happening in Layer 1's session wrapper. TDD2 corrects this: Pi has no native `cache_control` API; provider caching is a provider-shim concern. §8.2 reorganizes the design around what actually exists.

### 8.1 The meter

The token meter aggregates input/output/cache tokens per session, per task, per phase, per milestone, per provider. It is the source of truth for the TPAC north-star metric (§1.2).

**Implementation:** `packages/runtime/src/meter/token-meter.ts`.

**Input:** `SwtEvent.TASK_TOKEN_USAGE` events emitted by the session wrapper after each Pi turn (mapped from Pi's per-turn usage data on `message_end` or `turn_end`).

**Output:**

- `meter.snapshot()` returns the current aggregate by all dimensions.
- `meter.subscribe(listener)` emits `SwtEvent.METER_UPDATED` events for dashboard streaming.
- `meter.persist()` writes to `.swt-planning/journal/<date>.jsonl` for crash-resume.

**Storage shape (one row per task per provider per turn):**

```jsonc
{
  "timestamp": "2026-05-11T14:00:00.123Z",
  "milestone": "v3.0",
  "phase": "phase-01-foundation",
  "task_id": "T-2026-05-11-001",
  "role": "dev",
  "tier": "balanced",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "turn": 3,
  "input": 12450,
  "output": 1820,
  "cacheRead": 9800,
  "cacheWrite": 0,
  "cost_usd": 0.0287
}
```

**TPAC measurement:**

```
TPAC(milestone) = total_input_tokens(milestone) + total_output_tokens(milestone)
                  ───────────────────────────────────────────────────────────────
                                acceptance_criteria_shipped(milestone)
```

Where `acceptance_criteria_shipped` comes from the methodology's `.swt-planning/STATE.md` (count of completed must-have entries in the milestone window).

The `swt bench` verb (new) runs a reference scenario and reports TPAC.

### 8.2 Provider-level caching

Per-provider strategies (consolidated; previously fragmented in TDD.md§7):

#### 8.2.1 Anthropic (the primary cache target)

Anthropic supports `cache_control: { type: 'ephemeral' }` on individual content blocks. Cached blocks have a 5-minute TTL by default; long-cache requires the `supportsLongCacheRetention` flag (set per-model in `quirks.json` §7.5).

**SWT's strategy (achieving ≥70% hit ratio):**

1. **Deterministic system prompt prefix.** The role's system prompt is identical for every dispatch of that role. No timestamps, no random nonces.

2. **Stable artefact-block ordering.** `buildPrompt` (§8.3) emits artefacts in fixed order: PROJECT.md → REQUIREMENTS.md → STATE.md → PHASE.md → task brief.

3. **Cache breakpoint placement.** A `cache_control: { type: 'ephemeral' }` block is inserted after the artefact block and before the task-specific content. The block must contain ≥1024 tokens (Anthropic's documented minimum).

4. **Per-task cache discipline.** The task-specific block (the variable part) is NOT cached; only the role/artefact prefix is.

The breakpoint insertion happens in `packages/runtime/src/cache/anthropic-cache.ts`, invoked from the session wrapper's `prompt()` call.

**Measurement:** Anthropic's response includes `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`. The session wrapper extracts these and emits them on `SwtEvent.TASK_TOKEN_USAGE`. The meter aggregates them; the dashboard's Cache Hits panel (M4) plots `cache_read / (cache_read + input)` over time.

#### 8.2.2 OpenAI (implicit auto-cache)

OpenAI auto-caches identical prefixes of ≥1024 tokens with no opt-in. SWT v3 does NOT modify prompts for OpenAI caching — the determinism rules above are sufficient.

Measurement comes from `usage.prompt_tokens_details.cached_tokens` in OpenAI responses. Mapping is in `runtime/src/cache/openai-cache.ts`.

#### 8.2.3 Amazon Bedrock (Claude on Bedrock)

Per Pi docs: "Prompt caching is automatically enabled for Claude models" on Bedrock. SWT v3 treats this the same as Anthropic direct (same `cache_control` block; Bedrock observes it).

#### 8.2.4 Cloudflare Workers AI

Per Pi docs: SWT v3 inherits Pi's automatic `x-session-affinity` header for prefix-cache discounts. No SWT-specific work.

#### 8.2.5 Other providers (DeepSeek, Gemini, etc.)

No explicit cache; SWT v3 emits no `cache_control` blocks. The deterministic-prefix discipline still helps when providers add implicit caching later.

### 8.3 Explicit context injection (`buildPrompt`)

`buildPrompt` in `packages/core/methodology/prompt-builder/` constructs the message array for a dispatch.

**Inputs:**

- `role: Role`
- `phase: PhaseRef`
- `task: TaskBrief`
- `artefacts: ArtefactBundle` — the four `.swt-planning/` documents at the time of dispatch

**Output: `PromptContext` consumed by the session wrapper**

```ts
interface PromptContext {
  systemPrompt: string;                       // role-specific
  blocks: ContentBlock[];                     // ordered, deterministic
  cacheBreakpointIndex: number;               // where the provider should insert cache_control
}
```

**Ordering rule (strictly enforced):**

1. Role system prompt (constant per role)
2. Project context block (PROJECT.md + REQUIREMENTS.md + STATE.md, normalized to canonical newlines and frontmatter-stripped)
3. Phase context block (PHASE.md for the current phase)
4. ← **cacheBreakpointIndex** (a `cache_control` breakpoint is placed here for Anthropic; OpenAI auto-caches up to this point)
5. Task-specific context (the variable part: task brief, declared claims, must-haves)
6. Conversation history (empty for fresh sessions per Principle 7)

**Determinism guarantees:**

- No `Date.now()` in the prompt body.
- Artefact file contents are read from disk and SHA-256 hashed; the hash is logged but not embedded in the prompt.
- Whitespace normalization is byte-identical across runs (LF, no BOM, no trailing whitespace).
- Frontmatter is stripped using `gray-matter` with locked options.

Tests assert byte-identical prompts on cassette replay; differences fail CI.

### 8.4 Budget Gate

The Budget Gate enforces token-cost ceilings and dynamically downgrades behavior under pressure.

**Configuration (`.swt-planning/config.json#budget`):**

```jsonc
{
  "budget": {
    "currency": "USD",
    "milestone_ceiling": 50.00,
    "phase_ceiling": 10.00,
    "task_ceiling": 1.00,
    "pressure_thresholds": {
      "downgrade_at": 0.70,         // at 70% of ceiling, downgrade tiers one step
      "pause_at": 0.95              // at 95%, pause milestone, notify dashboard
    }
  }
}
```

**Behaviors:**

- **Hard ceiling reached:** Pause the milestone; emit `SwtEvent.BUDGET_PAUSED`; dashboard surfaces a "Budget exhausted" banner with a "Resume" button (which requires user confirmation; resume bumps ceiling).
- **Pressure threshold crossed (downgrade):** The role-resolver downgrades subsequent dispatches by one tier (e.g., `quality` → `balanced`). The downgrade is logged in the journal and surfaced as a yellow banner.
- **Per-task ceiling exceeded:** The task fails fast with `SwtError.BudgetExhausted`; the orchestrator records it as a budget-related failure, not a task-quality failure.

**State persistence:** the budget state lives in `.swt-planning/budget-state.json` and is journaled on every update. Resume is mechanical.

### 8.5 Compaction strategy

Pi's native compaction is enabled and tuned per role:

```jsonc
// .swt-planning/config.json (excerpt)
{
  "compaction": {
    "enabled": true,
    "default": { "reserveTokens": 16384, "keepRecentTokens": 20000 },
    "per_role": {
      "scout": { "keepRecentTokens": 8000 },
      "architect": { "keepRecentTokens": 30000 },
      "debugger": { "keepRecentTokens": 50000 }
    }
  }
}
```

The settings flow into Pi via the SessionManager / SettingsManager when `createSession` is called. Per-role overrides are applied by the session wrapper before delegating to Pi.

**Compaction is the last resort.** Principle 7 mandates fresh sessions per task; compaction triggers only when a long-running session (e.g., Architect mid-deliberation) approaches context limits. In normal operation, compaction events should be rare. The dashboard exposes a "Compactions per phase" metric; values > 1 per phase warrant investigation.

### 8.6 The full flow (from dispatch to billed dollars)

A timeline of how one Dev task burns tokens:

1. **Dispatch.** Orchestrator builds `TaskBrief`, calls `runtime.createSession({cwd: worktreePath, ...})`.
2. **Session creation.** Runtime calls `createAgentSession(...)` from Pi. Session wrapper subscribes to Pi events.
3. **Prompt build.** Methodology's `prompt-builder` produces `PromptContext` with stable ordering.
4. **First prompt.** Runtime's `session.prompt(text)` invokes Pi's `session.prompt(...)`.
5. **Provider request.** Pi calls the configured provider. Cache-control breakpoint observed by Anthropic; partial cache hit possible on cold first dispatch.
6. **First response.** Pi emits `turn_end` with `AgentMessage` containing `usage`. Session wrapper maps usage → `SwtEvent.TASK_TOKEN_USAGE`.
7. **Meter update.** Token meter aggregates; cost aggregator multiplies × `ProviderModelConfig.cost`; emits `SwtEvent.TASK_COST_UPDATED`.
8. **Budget check.** Budget Gate checks ceiling/pressure; potentially downgrades tier or pauses.
9. **Dashboard update.** SSE pushes meter + budget state to the client.
10. **Tool calls.** Dev uses `bashTool`, `editTool`, etc. (created via `createCodingTools(worktreePath)`). Each tool call is journaled.
11. **Result reporting.** Dev calls the `swt_report_result` custom tool (registered via Extension API). The tool's `execute` writes a `custom` entry to the session and returns `{terminate: true}`, hinting Pi to stop the LLM follow-up.
12. **Agent end.** Pi emits `agent_end`. Session wrapper emits `SwtEvent.TASK_COMPLETED` with parsed `TaskResult`. Orchestrator harvests.
13. **Worktree commit.** Orchestrator commits the worktree changes (one commit per task per Principle from v2.x).
14. **Cleanup.** Session disposed (`session.dispose()`); worktree either kept (for forensics or follow-up) or removed (`git worktree remove`).

The entire flow is journaled. Resume after `kill -9` at any step is the §9.5 recovery path.

---

## 9. Worktree-Based Subagent System

> **Δ from TDD.md§8:** TDD.md described `shouldStopAfterTurn` and `report_result` as built-in Pi mechanisms. They aren't (§5.13). TDD2 redesigns the result protocol around Pi's actual primitives (Extension custom tool + `agent_end` hook + `terminate: true`).

### 9.1 Worktree lifecycle

Every dispatched task gets its own git worktree at `.swt-planning/parallel/wt-<task-id>/`. The worktree is created from the same commit as the milestone branch and is treated as ephemeral.

**Lifecycle states (the FSM that the worktree manager owns):**

```
       (none)
          │
          ▼
     CREATED ──────────► CLAIMED ────────► RUNNING ────────► HARVESTED ────────► REMOVED
          │                  │                  │                   │
          │                  │                  │                   │
          ▼                  ▼                  ▼                   ▼
        FAILED            FAILED             FAILED              KEPT (forensics)
```

**Transitions:**

- `→ CREATED` — `git worktree add` succeeded; lock file written at `.swt-planning/locks/wt-<task-id>.lock`.
- `CREATED → CLAIMED` — claim registry validated the task's `claims[]` array; no conflicts.
- `CLAIMED → RUNNING` — Pi session created; first `prompt()` issued.
- `RUNNING → HARVESTED` — `swt_report_result` tool fired; result envelope parsed; orchestrator extracted result.
- `HARVESTED → REMOVED` — worktree merged or committed; `git worktree remove` succeeded.
- `* → FAILED` — at any point, errors push to FAILED. The worktree is kept until orchestrator's failure-mode decides to remove or retain (see §9.7).

**State persistence:**

```jsonc
// .swt-planning/parallel/wt-<task-id>/.state.json
{
  "schema_version": 1,
  "task_id": "T-2026-05-11-001",
  "state": "RUNNING",
  "created_at": "2026-05-11T14:00:00.000Z",
  "entered_state_at": "2026-05-11T14:01:23.000Z",
  "pid": 12345,
  "session_id": "pi-session-abc123",
  "claims": ["packages/runtime/src/session.ts"],
  "branch_base": "feat/v3-foundation"
}
```

The `.state.json` is written atomically (write to `.state.json.tmp` then `rename`) at every transition. Recovery (§9.5) reads it to decide resume vs abort.

#### 9.1.1 Cross-OS worktree path discipline

Windows worktrees have known quirks (case-insensitive FS, path length limits, `\r\n` line endings). v3 commits to Windows support (per §3.4 ci.yml matrix). Discipline:

- All worktree paths are POSIX-style (`/`) and converted to Win32 only at the `child_process.spawn` boundary.
- Path length: worktree paths capped at 200 chars (cwd + task ID); fail-fast at create time.
- Line-ending: `.gitattributes` in the worktree forces `eol=lf` for source files; worktree creation copies the parent's `.gitattributes` deliberately.

The M3 chaos test runs the full lifecycle on Windows runners.

### 9.2 Claim registry + conflict prevention

The claim registry prevents two parallel tasks from editing the same file.

**The registry is a single file**: `.swt-planning/parallel/claims.jsonl`. One line per active claim. Appended atomically; lines marked released are tombstoned (a separate compactor sweeps them on idle).

**Claim format:**

```jsonc
{
  "task_id": "T-2026-05-11-001",
  "claims": ["packages/runtime/src/session.ts", "packages/runtime/test/session.test.ts"],
  "acquired_at": "2026-05-11T14:00:00.000Z",
  "released_at": null,
  "worktree_path": ".swt-planning/parallel/wt-T-2026-05-11-001/"
}
```

**Acquisition algorithm:**

1. Read `claims.jsonl`. Build the set of currently-claimed paths.
2. For each path in the task's declared claims:
   a. If exact match in claimed set → CONFLICT.
   b. If prefix-match (parent dir already claimed exclusive) → CONFLICT.
   c. If subtree-match (task wants `pkg/` while another task has `pkg/file.ts`) → CONFLICT.
3. If no conflicts: append a new line claiming all paths atomically.
4. If conflict: reject; orchestrator either queues the task or escalates.

**Conflict resolution policy:** by default, parallel tasks with overlapping claims are **serialized** (queued for after the conflicting task completes), not rejected. The DAG resolver §9.3 batches accordingly. Hard-reject is only triggered when the conflict implies a methodology error (e.g., two parallel tasks were supposed to coordinate but the plan declared them independent).

**Enforcement during execution:** the Pi session for a task uses tool factories scoped to `cwd = worktreePath`. Any tool call writing outside the worktree fails (because the tool's `cwd` is the worktree, and write/edit tools reject absolute paths outside `cwd`). This is enforced by Pi's built-in tool factories; SWT v3 layers a stricter `path-claim-validator.ts` that additionally rejects writes to paths inside the worktree NOT in the claim list. The validator hooks via the Extension `tool_call` hook with `{ block: true, reason: 'claim-violation' }`.

**Audit trail:** every claim acquire/release is journaled. The dashboard's Worktrees panel shows the active claims map in real-time.

### 9.3 DAG resolver

A phase plan contains tasks with `depends_on` arrays. The resolver computes execution batches.

**Algorithm:**

1. Topological-sort tasks by `depends_on`.
2. Partition into batches: batch N contains all tasks whose dependencies are in batches < N.
3. Within a batch, further partition by claim conflicts (tasks with overlapping claims are serialized into sub-batches).
4. Return a list of `Batch[]`, each batch a list of tasks that can run truly in parallel.

**Cycle detection:** if the topological sort detects a cycle, the resolver throws `SwtError.PlanHasCycle` with the cycle path. The methodology's plan validator rejects plans with cycles before they ever reach the resolver, so this should be unreachable in production.

**Bounded parallelism:** the dispatcher consumes batches sequentially; within a batch, it spawns up to `config.max_parallel_tasks` worktrees (default: 3). When a task completes, the next queued task from the same batch starts. When the batch empties, the next batch begins.

**Why bounded:** unbounded parallelism saturates the provider (rate limits) and the local machine (CPU + disk). The default of 3 is conservative; the M3 gate measures the optimal value on the reference repo.

### 9.4 Result protocol

> **This section replaces TDD.md's `report_result` claim.** TDD.md asserted `report_result` was a built-in Pi tool. It is not (§5.13). The replacement is a custom tool registered via Extension API plus an `agent_end` hook.

The result envelope schema (`packages/shared/src/schemas/task-result.ts`):

```ts
import { z } from 'zod';

export const TaskResultSchema = z.object({
  schema_version: z.literal(1),
  task_id: z.string(),
  status: z.union([
    z.literal('success'),
    z.literal('failed'),
    z.literal('partial'),
    z.literal('blocked'),
  ]),
  summary: z.string().max(4096),
  files_changed: z.array(z.object({
    path: z.string(),
    action: z.union([z.literal('created'), z.literal('modified'), z.literal('deleted')]),
    bytes_before: z.number().int().nonnegative(),
    bytes_after: z.number().int().nonnegative(),
    sha256_after: z.string().regex(/^[0-9a-f]{64}$/),
  })),
  must_haves: z.array(z.object({
    id: z.string(),
    status: z.union([z.literal('passed'), z.literal('failed'), z.literal('skipped')]),
    evidence: z.string().optional(),
  })),
  follow_up_tasks: z.array(z.object({
    description: z.string(),
    suggested_role: z.string().optional(),
  })).optional(),
  artefacts_written: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type TaskResult = z.infer<typeof TaskResultSchema>;
```

**The `swt_report_result` tool (registered via Extension API):**

```ts
// packages/runtime/src/extensions/result-protocol.ts
import { Type } from '@sinclair/typebox';

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'swt_report_result',
    label: 'Report SWT task result',
    description: 'Persist the SWT task result envelope before exiting. Call this exactly once at the end of the task. After calling, do not produce more text; the orchestrator harvests immediately.',
    promptSnippet: 'swt_report_result — finalize the task and exit',
    promptGuidelines: [
      'Call swt_report_result exactly once before stopping.',
      'After calling, do not produce more text.',
      'Set status="failed" with blockers[] populated if you cannot complete.',
    ],
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal('success'),
        Type.Literal('failed'),
        Type.Literal('partial'),
        Type.Literal('blocked'),
      ]),
      summary: Type.String({ minLength: 1, maxLength: 4096 }),
      files_changed: Type.Array(Type.Object({
        path: Type.String(),
        action: Type.Union([Type.Literal('created'), Type.Literal('modified'), Type.Literal('deleted')]),
      })),
      must_haves: Type.Array(Type.Object({
        id: Type.String(),
        status: Type.Union([Type.Literal('passed'), Type.Literal('failed'), Type.Literal('skipped')]),
        evidence: Type.Optional(Type.String()),
      })),
      blockers: Type.Optional(Type.Array(Type.String())),
      notes: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Compute file metadata server-side for trustworthiness
      const enriched = await enrichWithFileMetadata(ctx.cwd, params);
      // Persist as a `custom` session entry (NOT in LLM context).
      // appendEntry lives on ExtensionAPI (`pi`), captured in closure — see §5.4 boundary note.
      pi.appendEntry('swt-task-result', enriched);
      return {
        content: [
          { type: 'text', text: `Task result recorded: ${params.status} (${params.must_haves.length} must-haves checked).` },
        ],
        details: enriched,
        terminate: true,
      };
    },
  });

  // Defensive harvester: if the agent ends without calling swt_report_result, mark as malformed
  pi.on('agent_end', (event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const resultEntry = entries.find(e => e.type === 'custom' && (e as any).customType === 'swt-task-result');
    if (!resultEntry) {
      pi.appendEntry('swt-task-result', {
        schema_version: 1,
        task_id: getTaskIdFromCtx(ctx),
        status: 'failed',
        summary: '(agent ended without calling swt_report_result)',
        files_changed: [],
        must_haves: [],
        blockers: ['protocol-violation: swt_report_result not called'],
      });
    }
  });
}
```

**Harvest path (orchestrator side):**

```ts
// packages/orchestration/src/dispatcher.ts (sketch)
async function dispatch(task: TaskBrief): Promise<TaskResult> {
  const session = await createSession({ /* ... */ });
  const promptCtx = await buildPrompt({ role: task.role, task, phase: task.phase, artefacts });
  await session.prompt(renderPrompt(promptCtx));

  // Wait for TASK_COMPLETED (mapped from agent_end after result entry written)
  const completed = await waitForEvent(session, 'TASK_COMPLETED');

  // Parse result from session entries (durable across restarts)
  const sessionFile = session.sessionFile;
  const result = parseTaskResultFromSession(sessionFile);
  return TaskResultSchema.parse(result);  // throw if malformed
}
```

The handshake is **two-channel**: the in-process event (`TASK_COMPLETED`) gives the orchestrator a fast notification; the durable session entry (`swt-task-result` custom entry) is the source of truth for the result envelope. If the orchestrator crashes before reading the event, the session entry is still on disk for the recovery path to read.

### 9.5 Crash recovery

**The recovery FSM,** invoked at orchestrator startup:

1. **Scan locks.** Read all `.swt-planning/locks/*.lock` files.
2. **Verify PID liveness.** For each lock, run `kill -0 <pid>` (or platform equivalent on Windows).
3. **Classify each lock:**
   - **alive + state RUNNING**: assume the peer is still working; do not reclaim; emit `ORPHAN_PEER_DETECTED`.
   - **dead + state HARVESTED**: cleanup-only; remove lock, remove worktree if config says so.
   - **dead + state RUNNING**: this is the crash case. Decide resume vs abort.
4. **Resume decision (per crashed task):**
   - Read the task's session file (`{worktree}/.pi-session/<sessionId>.jsonl`).
   - Look for an `swt-task-result` custom entry. If present: harvest result, mark task COMPLETED.
   - If absent: walk the journal (`.swt-planning/journal/*.jsonl`) for the last journaled transition. If the last transition was a tool call mid-flight, the worktree state may be partial. Decision:
     - **Worktree clean** (verified by `git diff --quiet` inside the worktree): resume by re-issuing the prompt with a context hint ("you were interrupted; check tool results in your history and continue").
     - **Worktree dirty but consistent** (`git diff` shows changes that match the journaled tool calls): resume similar.
     - **Worktree inconsistent** (changes don't match the journal): mark task FAILED with `{blockers: ['inconsistent-recovery-state']}`; preserve worktree for forensics; orchestrator emits a dashboard alert.

5. **Cleanup post-recovery:** Remove stale locks; release stale claims (in `claims.jsonl`); commit a journal entry recording the recovery decision.

**The recovery test (M3 gate):**

```ts
// packages/orchestration/test/recovery.test.ts (sketch)
it('resumes a dev task after SIGKILL during tool execution', async () => {
  const orchestrator = await createOrchestrator(...);
  const plan = await loadFixture('plans/dev-edit-then-run.json');
  const kill = scheduleKill(orchestrator, /* after this many ms */ 200);
  await expectThrows(orchestrator.run(plan), 'killed');

  const newOrchestrator = await createOrchestrator(...);  // simulate restart
  const result = await newOrchestrator.run(plan);
  expect(result.tasks[0].status).toBe('success');
});
```

The chaos suite (§14.10) injects kills at every transition.

### 9.6 Lease locks + event recovery

Beyond crash recovery, two operational concerns matter:

**Lease locks** prevent two orchestrators from competing. The dashboard daemon (which can spawn an orchestrator) and the CLI (which can spawn an orchestrator directly) both must acquire `.swt-planning/locks/orchestrator.lock` before doing anything. The lease is renewed every 30 seconds; if the lease expires (process died without releasing), the next claimer can take over.

**Event recovery** ensures dashboard SSE consumers receive missed events when they reconnect. The dashboard's event bus uses `Last-Event-Id` per SSE spec; on reconnect, the client sends the last event ID; the server replays from the journal. This means: even if the dashboard crashes mid-phase, refreshing the browser delivers a complete event stream. Implementation lives in `dashboard/src/server/event-bus.ts`.

### 9.7 Worktree retention policy

After a task completes (success, failed, or blocked), the worktree manager decides whether to keep or remove the worktree:

| Status | Default policy | Override |
|---|---|---|
| `success` | Remove after merging to phase branch | `config.keep_successful_worktrees: true` |
| `partial` | Keep (user may resume) | manual cleanup via `swt cleanup` |
| `failed` | Keep (forensics) | `config.gc_failed_worktrees_after_days: N` |
| `blocked` | Keep (user intervention) | manual cleanup |

A separate `swt cleanup` verb (new in M3) sweeps old worktrees by age and status. The dashboard's Worktrees panel shows the retention age and exposes a one-click delete.

---

## 10. The Six Roles, Reframed for Pi

> **Δ from TDD.md§9:** TDD.md§9 was structurally sound but listed the six roles without per-role technical specifications (tool subsets, prompt-strategy details, session-resume behavior). TDD2 fills these in.

### 10.1 Role definitions

| Role | Mission | Output artefact | Default tier | Default tool subset |
|---|---|---|---|---|
| **Scout** | Compress a codebase region into a short, accurate brief | `scout-brief.md` (≤2 KB) | `cheap-fast` | `read`, `grep`, `find`, `ls` (read-only) |
| **Architect** | Decide a phase-plan or design trade-off; produce a plan artefact | `plan-NN.md` | `quality` | `read`, `grep`, `find`, `ls` |
| **Lead** | Coordinate the phase: parse plan, dispatch dev tasks, integrate results | `phase-summary.md` | `balanced` | All tools (full coding set) |
| **Dev** | Implement a single task end-to-end inside its worktree | `swt-task-result` entry | `balanced` | All tools (full coding set) scoped to worktree |
| **QA** | Run goal-backward verification; gate phase completion | `qa-report.md` | `balanced` (LLM tier; static checks first) | `read`, `bash` (read + run tests/lints) |
| **Debugger** | Root-cause a failure that other roles couldn't resolve | `debug-report.md` | `reasoning` | All tools + extended thinking |

Each role's full prompt and tool-subset definition lives in `packages/core/methodology/profiles/<role>.ts`. Prompt files are co-located: `packages/core/methodology/profiles/<role>.prompt.md`.

### 10.2 Per-role tier defaults and override paths

Default tiers (above) live in `core/methodology/profiles/<role>.ts`. They are overridable at **four levels** (precedence in increasing order):

1. **Built-in default** — the role's `defaultTier`.
2. **User config** — `~/.swt/roles.json#<role>.tier`.
3. **Project config** — `.swt-planning/config.json#roles.<role>.tier`.
4. **Task override** — `task.tier` in the plan.

When overrides are active, the role-resolver logs the override decision with the source level. The dashboard's Roles panel surfaces the running distribution.

### 10.3 System prompt strategy

Per Principle 4 (subagents are processes, not LLM features), no role's prompt mentions "you are a subagent" or any orchestration term. Each prompt is task-shaped:

**Scout system prompt (excerpt):**

```
You are a focused code reader. Your task is to read the indicated files, answer the
specific question in the brief, and produce a compact written summary.

Constraints:
- Use only the read/grep/find/ls tools.
- Do not propose changes. Your output is a brief, not a plan.
- Aim for ≤2 KB of summary text. Cite file:line references for every claim.
- Call swt_report_result once you have the brief; do not produce more text after.
```

**Architect system prompt (excerpt):**

```
You are deciding a plan or trade-off. Your job is to produce a single, well-justified
recommendation and a phase plan that implements it.

Constraints:
- Read the artefacts in your context to ground the decision.
- The plan must list tasks with file claims and depends_on edges.
- Each task must declare must-haves that verify its completion.
- Call swt_report_result once your plan is final.
```

(Full prompts in `packages/core/methodology/profiles/`.)

### 10.4 Tool subset enforcement

Role tool subsets are enforced at session creation:

```ts
// packages/orchestration/src/dispatcher.ts (sketch)
function toolsForRole(role: Role, cwd: string): AgentTool[] {
  switch (role) {
    case 'scout':     return createReadOnlyTools(cwd);
    case 'architect': return createReadOnlyTools(cwd);
    case 'lead':      return createCodingTools(cwd);
    case 'dev':       return createCodingTools(cwd);
    case 'qa':        return [...createReadOnlyTools(cwd), createBashTool(cwd)];
    case 'debugger':  return createCodingTools(cwd);
  }
}
```

The Pi session is created with `tools: toolsForRole(role, worktreePath)`. The role cannot expand its toolset; the orchestrator owns this decision.

### 10.5 Per-role session and thinking-level discipline

| Role | Session mode | Thinking level | Compaction tuning |
|---|---|---|---|
| Scout | Ephemeral (`SessionManager.inMemory()`) | `off` | n/a (sessions stay small) |
| Architect | Ephemeral but optionally persistent for forensics | `medium` for normal; `high` for design-heavy phases | `keepRecentTokens: 30000` |
| Lead | Persistent per phase; multiple dispatches share | `low` (mostly tool-calling) | default |
| Dev | Ephemeral per task | `low` for routine; `medium` for tricky | default |
| QA | Ephemeral | `low` | default |
| Debugger | Persistent per investigation | `xhigh` (per §7.1.1; the provider-level fallback to `high` happens in `thinkingLevelMap` when a model can't accept `xhigh`) | `keepRecentTokens: 50000` |

These map onto Pi via the `thinkingLevel` option to `createAgentSession` and the per-session compaction overrides applied in the session wrapper. The Pi value flows through `quirks.json` to the provider-specific field; SWT code only ever sees Pi's `ThinkingLevel` enum.

### 10.6 Cross-role handoff

A phase typically runs: Lead asks Scout → Lead asks Architect → Lead dispatches Dev tasks → QA → optionally Debugger. The handoff is via **artefacts on disk**, not in-process messages. Each role's output is a file in `.swt-planning/`; the next role reads the file.

Why disk-based: it survives crashes, supports parallel reads, and lets the dashboard show what each role produced without instrumenting the orchestrator.

The handoff schemas live in `packages/core/handoff/` (preserved from v2.x).

---

## 11. Methodology Layer (Preserved + Cleaned)

> **Δ from TDD.md§3.1:** TDD.md said the methodology engine is preserved. TDD2 confirms preservation **after** discharging the constitutional debt visible in v2.3.5's `package.json` (the `methodology → codex-driver` edge). The cleanup is the M1 entry gate, not its exit.

### 11.1 Phase lifecycle state machine

The phase FSM (preserved verbatim from v2.x):

```
        PENDING
           │  (Lead acknowledges, Architect plans)
           ▼
        PLANNED
           │  (Lead dispatches first batch)
           ▼
        ACTIVE
           │
       ┌───┴──────┐
       │          │
       ▼          ▼
   REMEDIATION   COMPLETE
       │          │
       └──┬───────┘
          │
          ▼
       (next phase)
```

**Transitions:**

- `PENDING → PLANNED` — Architect's plan artefact lands; methodology validator accepts it.
- `PLANNED → ACTIVE` — Lead begins dispatching.
- `ACTIVE → REMEDIATION` — QA gate fails; methodology re-dispatches with corrective context.
- `REMEDIATION → ACTIVE` — Remediation tasks complete; QA re-runs.
- `ACTIVE → COMPLETE` — QA gate passes; phase summary written; STATE.md updated.

Each transition appends to `.swt-planning/STATE.md`'s Activity Log (preserved from v2).

### 11.2 Must-haves and goal-backward QA

Must-haves are the source of truth for "did the phase achieve its goal?". Each plan declares must-haves; each task declares which must-haves it advances; QA verifies each must-have against test/lint/grep evidence.

**Must-have shape (Zod):**

```ts
const MustHaveSchema = z.object({
  id: z.string().regex(/^MH-\d+$/),
  text: z.string().min(1),
  verification: z.union([
    z.object({ kind: z.literal('tests'), command: z.string(), expect_exit: z.number().default(0) }),
    z.object({ kind: z.literal('grep'), pattern: z.string(), expect_match: z.boolean() }),
    z.object({ kind: z.literal('file-exists'), path: z.string() }),
    z.object({ kind: z.literal('llm-check'), prompt: z.string() }),  // last resort
  ]),
  priority: z.union([z.literal('P0'), z.literal('P1'), z.literal('P2')]),
});
```

Phase completion requires all P0 must-haves green. P1 must-haves block release-candidate cutting but not phase completion (they convert into follow-up tasks in the next phase). P2 are advisory.

### 11.3 `.swt-planning/` artefact schemas (Zod + version policy + migration)

Artefact schemas live in `packages/core/artefacts/schemas/` and are exposed via `packages/shared/schemas/`.

**Schema version policy:**

- Every artefact JSON has a top-level `schema_version: <int>`.
- v3.0 introduces `schema_version: 1` (additive only; no breaking change vs v2.x's implicit-versionless schema).
- Future v3.x changes follow semver: minor for additive fields, major for breaking.
- The migration script (`swt migrate --to=v3`) sets `schema_version: 1` on every artefact that doesn't already have one, plus the v2→v3 specific transformations.

**v2→v3 transformations (per artefact):**

- `.swt-planning/config.json`: remove `backend: codex|claude-code|ollama` field; add `roles[*].tier` with defaults from the role-resolver; add `router_strategy: 'tier-routed'`.
- `.swt-planning/PROJECT.md`: no change.
- `.swt-planning/REQUIREMENTS.md`: no change.
- `.swt-planning/ROADMAP.md`: no change (phase format unchanged).
- `.swt-planning/STATE.md`: no change.
- `.swt-planning/phases/NN-slug/plan-NN.md`: gains `claims` and `depends_on` fields per task; the migration adds empty `claims: []` and inferred `depends_on: []` from any existing prose dependencies.
- New directory: `.swt-planning/parallel/` — created empty.
- New directory: `.swt-planning/journal/` — created empty.
- New directory: `.swt-planning/locks/` — created empty (and `.gitignore`'d).
- New file: `.swt-planning/budget-state.json` — initialized to zeros.

The migration is **idempotent**: running `swt migrate --to=v3` twice produces the same result. Tests assert this.

### 11.4 Phase routing logic

The phase router (in `packages/core/methodology/state/`) decides what happens next after each event. Inputs: current STATE.md, the active phase, the last task result, the QA tier policy. Outputs: a next-action recommendation.

**Routing rules (preserved from v2 with one addition for v3):**

- After Architect's plan lands → start dispatching first batch.
- After all Dev tasks in a batch complete → if more batches, dispatch next; else trigger QA.
- After QA passes → advance phase; emit phase-complete event.
- After QA fails → enter REMEDIATION; dispatch a Debugger task with QA's failure as input.
- After Debugger returns → re-attempt the failed tasks with Debugger's recommendations as additional context.
- **NEW in v3:** after a task returns `status: 'blocked'` → halt dispatch; surface to dashboard; await user input.

The router is **stateless given the same STATE.md**: replaying STATE.md produces the same routing decisions. Tests use a golden-input/golden-output pattern.

### 11.5 Breaking the codex-driver edges (the M1 entry gate)

Two v2.3.5 source-edges violate Constitutional Principles 1 and 3 and must be broken before any Pi integration begins. Both are part of the **M1 entry gate** (§13.1.1).

**Edge A — `methodology → codex-driver`** (Principle 1 violation):

`packages/methodology/package.json` declares `@swt-labs/codex-driver` as a runtime dependency. The only concrete import site is `packages/methodology/src/vibe/handlers/bootstrap.ts` which pulls `writeAgentsMdBlock`. Through that single function the methodology touches:

1. **Subagent spawning** — indirectly via `codex-driver/spawn/` (`codex exec` subprocess wrapper)
2. **Per-agent TOML hook emission** — `codex-driver/toml/` writes agent-specific TOML for Codex to consume
3. **Codex path resolution** — `codex-driver/paths.ts` finds the Codex install

**Edge B — `cli → {codex,claude-code,ollama}-driver`** (Principle 3 violation, three driver edges):

Source imports (verified against v2.3.5 source):
- `packages/cli/src/commands/vibe.ts` imports **three** spawners: `CodexAgentSpawner` from `@swt-labs/codex-driver`, `ClaudeCodeAgentSpawner` from `@swt-labs/claude-code-driver`, and `OllamaAgentSpawner` from `@swt-labs/ollama-driver`.
- `packages/cli/src/commands/doctor.ts` imports `detectCodexVersion` + `CodexVersion` from `@swt-labs/codex-driver`.

The vibe.ts case is the worse violation: a single source file imports *every* driver package, with imperative `if/else` logic inside the verb to pick which spawner to instantiate based on the `backend:` config field. v3 collapses all three into a single `SpawnerEnvironment.getSpawner()` call that returns an `AgentSpawner` regardless of backend.

**How v3 breaks both:**

| Edge | Replacement | Concretely |
|---|---|---|
| methodology → codex-driver (`writeAgentsMdBlock`) | `core/abstractions/AgentSpawner` interface call | The v2 concrete (codex-driver's spawner) is deleted; v3's concrete is `orchestration/dispatcher.ts` which goes through `runtime/`. TOML hook emission and path resolution disappear entirely (Pi doesn't consume TOML). |
| cli → {codex,claude-code,ollama}-driver (`CodexAgentSpawner`, `ClaudeCodeAgentSpawner`, `OllamaAgentSpawner` from vibe.ts; `detectCodexVersion` from doctor.ts) | `core/abstractions/SpawnerEnvironment` (new minimal adapter) | `doctor` queries the abstraction's `probe()`; `vibe` requests a spawner via `env.getSpawner()`. The backend-selection if/else inside vibe.ts moves into `SpawnerEnvironment.getSpawner()`. CLI never imports a driver directly. |

**The PR sequence in M1 (canonical numbering matches §13.1.2):**

| PR | Subject |
|---|---|
| **PR-01a** *(entry gate)* | Break `methodology → codex-driver`: replace the `bootstrap.ts` import with the `AgentSpawner` abstraction; remove the dep from `methodology/package.json`; update affected tests. |
| **PR-01b** *(entry gate)* | Break `cli → {codex,claude-code,ollama}-driver`: introduce `core/abstractions/SpawnerEnvironment`; rewire `cli/commands/vibe.ts` (removes 3 spawner imports + the backend if/else dispatch) and `cli/commands/doctor.ts` (removes detectCodexVersion + CodexVersion). |
| PR-02 | Add `packages/runtime/` skeleton with mock `AgentSpawner` impl; methodology tests pass against the mock. |
| PR-03 | Add `packages/orchestration/` with `AgentSpawner` impl going through `runtime/`. |
| PR-04 | Add `packages/shared/` (types + Zod schemas). |
| PR-05 | Delete `packages/{codex,claude-code,ollama}-driver/`; regenerate `pnpm-lock.yaml`. |

**M1 entry gate** = PR-01a **and** PR-01b both merged. The entry-gate grep invariant (§13.1.1) must return zero hits before PR-02 can land. The M1 exit gate (§13.1.3) is much broader and lands the rest of the table above.

### 11.6 Audit subsystem

The `methodology/audit/` package implements the codebase-audit subsystem used by the Scout role. It does targeted reads (grep/find/list), produces summaries, and saves them as artefacts in `.swt-planning/scout-briefs/<topic>.md`.

In v3, the audit subsystem is **unchanged** except that its execution goes through the orchestrator (dispatched as a Scout task, with claims always read-only). The audit code itself didn't have a Codex dependency in v2 — it produced text that Codex consumed; v3 routes that text through Pi instead.

### 11.7 Discussion mode (vibe loop)

The `methodology/discussion/` and `methodology/vibe/` packages implement the interactive "discuss with me" mode the user invokes via `swt vibe`. This is **preserved verbatim** in v3 — the only change is that the underlying LLM call goes through Pi instead of Codex. The vibe loop's state machine and discussion protocol are unchanged.

The dashboard's vibe panel (`dashboard/server/vibe/methodology-agent.ts`) is the v3-and-forward consumer. The codex-coupled `dashboard/server/vibe/codex-methodology-agent.ts` is deleted.

### 11.8 Memory subsystem

The `methodology/memory/` package implements session-bound memory (per-session ephemeral) vs project memory (`.swt-planning/MEMORY.md`, persistent). v2's implementation is **preserved** with one adjustment: session-bound memory now consults Pi's `SessionManager.getEntries()` directly via the runtime adapter's `MemoryStore` impl. The interface (`core/abstractions/MemoryStore`) is unchanged.

### 11.9 Profiles, prompt-builder, qa, state

These four sub-packages in `methodology/` are **preserved verbatim** in v3:

- `profiles/`: per-role definitions (system prompt, tool subset, tier).
- `prompt-builder/`: deterministic `buildPrompt` per §8.3.
- `qa/`: goal-backward verification logic; integrates with `verification/runner.ts`.
- `state/`: phase routing logic per §11.4.

All four are vendor-agnostic in v2 already; the only change is that they're now under `packages/core/methodology/` instead of `@swt-labs/methodology`.

---

## 12. Dashboard Integration

> **Δ from TDD.md§10:** TDD.md§10 named the dashboard as preserved + extended without enumerating the v2 routes. TDD2§12 lists every existing route (verified from `packages/dashboard/src/server/routes/`) and explicitly maps each to its v3 disposition (preserved / extended / new).

### 12.1 Existing dashboard surface (v2.3.5, verified)

The Hono server at `packages/dashboard/src/server/index.ts` is bound to `127.0.0.1:<port>` (default `54321`, or `PORT` env). The `binding-guard.ts` rejects non-loopback bindings unless the caller passes `allowPublic: true` explicitly.

**17 HTTP routes registered (verified by grep):**

| Route | Method | Purpose | v3 disposition |
|---|---|---|---|
| `/api/health` | GET | liveness | preserved |
| `/api/snapshot` | GET | current STATE.md + derived state | preserved |
| `/api/events` | GET | SSE event stream | **rewired** to consume Pi events through `runtime/` |
| `/api/commands` | GET | list available CLI verbs (mirror) | preserved, table updated for v3 verbs |
| `/api/command` | POST | invoke a CLI verb from the dashboard | preserved, allow-list updated |
| `/api/config` | GET | read `.swt-planning/config.json` | preserved |
| `/api/config` | POST | write `.swt-planning/config.json` (Zod-validated) | preserved, schema extended for v3 fields |
| `/api/doctor` | GET | environment probe | **rewired** to check Pi instead of Codex |
| `/api/detect-phase` | GET | infer current phase from STATE.md | preserved |
| `/api/init` | POST | bootstrap a new project | preserved |
| `/api/artifact` | GET | read an artefact file (PROJECT.md, etc.) | preserved |
| `/api/vibe` | POST | start a vibe session | **rewired** to call new `methodology-agent` instead of codex variant |
| `/api/vibe/:session_id/reply` | POST | reply within a vibe session | preserved, session backend swapped |
| `/api/uat/:phase/checkpoint` | POST | record a UAT checkpoint | preserved |
| `/api/update` | GET | check for new SWT version on npm | preserved |
| `/api/update/apply` | POST | trigger `swt update` from dashboard | preserved |
| `/api/_debug/emit` | POST | test-only event emitter | preserved (test-only) |

**New routes added in v3** (table separated to keep the v2 audit honest):

| Route | Method | Purpose | Lands in |
|---|---|---|---|
| `/api/worktrees` | GET | list active worktrees (§12.3.1) | M3 |
| `/api/worktrees/sse` | GET | SSE stream of worktree state | M3 |
| `/api/worktrees/:id/abort` | POST | abort an active worktree | M3 |
| `/api/meter/sse` | GET | token-meter SSE stream (feeds Cache Hits + Cost panels) | M4 |
| `/api/cache-hits/sse` | GET | cache-hit ratio stream (§12.3.2) | M4 |
| `/api/cost/sse` | GET | per-provider cost stream (§12.3.4) | M5 |
| `/api/budget/sse` | GET | budget-state SSE (§12.3.3) | M4 |
| `/api/budget/resume` | POST | resume after budget pause | M4 |
| `/api/bench/sse` | GET | TPAC trend (§12.3.5) | M4 |
| `/api/metrics` | GET | Prometheus exposition (§16.2); opt-in via config flag | M2 |

### 12.2 SSE bridge: from Codex events to Pi events

The v2 events are emitted by the methodology layer when codex's hooks fire. In v3, the source changes:

**v2 flow:**
```
codex exec ──hooks.json──► .codex-plugin/hook handlers
                                     │
                                     ▼
                            event bus (in-process)
                                     │
                                     ▼
                          dashboard SSE (/api/events)
```

**v3 flow:**
```
Pi session ──subscribe()──► runtime/events.ts (normalize)
                                     │
                                     ▼
                          orchestration/journal/append.ts (durable)
                                     │
                                     ▼
                            event bus (in-process)
                                     │
                                     ▼
                          dashboard SSE (/api/events)
```

The dashboard's SSE consumer code is **unchanged**. Only the event source changes. The `SwtEvent` discriminated union (§5.5) is what the SSE channel emits; the SPA was already consuming a Zod-typed event stream and continues to.

**Last-Event-Id resume:** the v2 SSE bridge already supports `Last-Event-Id` for SSE reconnection. v3 extends this to back-fill from the journal (per §9.6), letting the dashboard recover events from a daemon crash, not just a network blip.

### 12.3 New panels for v3

Five new panels join the SPA in M3-M5. Each lives in its own Solid component, registered through the existing layout-storage v2 system (5-column main + tools array, preserved).

#### 12.3.1 Worktrees panel (M3)

Shows currently-active worktrees (`.swt-planning/parallel/wt-<id>/`). For each worktree: task ID, role, model, state (`CREATED|CLAIMED|RUNNING|HARVESTED|REMOVED|FAILED`), elapsed time, claims, last journaled event.

**Data source:** GET `/api/worktrees` (new) returns the worktree list; SSE `/api/worktrees/sse` streams updates.

**Interactions:** click a worktree to expand its journal trail; right-click to abort (calls POST `/api/worktrees/:id/abort`).

#### 12.3.2 Cache Hits panel (M4)

Plots `cache_read / (cache_read + input)` over time, per provider, with breakdown by role.

**Data source:** SSE `/api/meter/sse` (new); same stream feeds the Cost panel.

**Targets shown:** the 70% target line is drawn; bars below 70% are highlighted; persistent below-target triggers a "discipline alert" (e.g., "Architect role's cache hit dropped to 45% — check prompt determinism").

#### 12.3.3 Budget panel (M4)

Shows current spend, ceiling, and pressure thresholds (§8.4). Live gauge from `.swt-planning/budget-state.json`.

**Data source:** SSE `/api/budget/sse`.

**Interactions:** when budget reaches the pause threshold (95%), a "Resume with bumped ceiling" button appears.

#### 12.3.4 Per-Provider Cost panel (M5)

Stacked bar chart: cost per provider, per role, per phase. Helps users see "we spent $14 on debugging across 3 Anthropic sessions; we could shift the Debugger role to DeepSeek-R1 for similar quality at $4."

**Data source:** SSE `/api/cost/sse`.

#### 12.3.5 TPAC panel (M4)

The north-star metric. Shows TPAC by milestone, with the v3 target baseline and the current measurement. Trend line from `swt bench` runs.

**Data source:** SSE `/api/bench/sse` (new).

### 12.4 Permission gate evolution

v2.x has `DashboardPermissionGate` (session-keyed for vibe sessions). The deferred work flagged in v2.3.x — `UiPermissionGate` for direct UI mutations — lands in v3 M2.

**Architecture:**

```ts
// packages/dashboard/src/server/vibe/permission-gate.ts (extended in v3)

export interface PermissionGate {
  authorize(
    operation: ProtectedOperation,
    context: PermissionContext,
  ): Promise<PermissionDecision>;
}

export class DashboardPermissionGate implements PermissionGate {
  // session_id required; existing behavior preserved
}

export class UiPermissionGate implements PermissionGate {
  // For mutations originating from UI clicks with NO session_id.
  // Checks: CSRF token, recent user activity, optional confirmation dialog.
}

export class CompositeGate implements PermissionGate {
  // Routes by context.source: 'vibe' → DashboardGate, 'ui' → UiGate, 'api' → forbid
}
```

The `CompositeGate` is the default; v2's `DashboardPermissionGate` becomes one branch of it.

**Routes that route through UiPermissionGate** (new for v3, mostly mutations originating from button clicks):

- POST `/api/config` (when source is dashboard)
- POST `/api/update/apply`
- POST `/api/worktrees/:id/abort`
- POST `/api/budget/resume` (resume after pause)

The session-id-keyed `DashboardPermissionGate` continues to govern vibe-originating mutations.

### 12.5 Layout-storage v2 + palette preservation

The 5-column layout + tools array (introduced in v2.3) is **preserved verbatim**. New panels (§12.3) plug into the existing layout-storage schema as additional columns or as entries in the tools array.

The cmd-K palette with subsequence fuzzy match is **preserved verbatim**. New commands (`Open worktrees`, `Show TPAC`, `Resume budget`) register through the existing command-registry-mirror pattern.

### 12.6 CSP and binding guards (preserved)

The `lib/csp.ts` security headers middleware is preserved. CSP is strict (`default-src 'self'`); the SPA is built as a static bundle and served from the same origin.

The `lib/binding-guard.ts` rejecting non-loopback bindings is preserved. v3 adds the option for explicit `--bind 0.0.0.0` with `--allow-public` (already in v2 but underdocumented; v3 documents it).

### 12.7 Markdown rendering pipeline

`server/markdown/render.ts` uses remark + rehype-sanitize + rehype-stringify with Shiki for code highlighting. **Preserved verbatim.** No v3 changes.

### 12.8 Snapshot model

The snapshot subsystem (`server/snapshot/`) builds a reactive in-memory model of `.swt-planning/` state via `chokidar` file watching. It's the source for `/api/snapshot` and `/api/events`. **Preserved**; the only addition is that the snapshotter now also watches `.swt-planning/parallel/` and `.swt-planning/journal/`.

---

## 13. Migration Plan — M1-M6

> **Δ from TDD.md§11:** TDD.md§11 listed milestones and gates. TDD2§13 expands each milestone with: deliverables at file/PR level, the exit gate criteria, exit-interview checklist, rollback plan, and explicit risk register.

**Reading the deliverable tables:** each milestone's table lists the *infrastructure-bearing* PRs that gate the milestone's exit. The ex-stub verb implementations promised by the §3.2.4 disposition table land **within these same PRs** (e.g., `swt plan` lands in M2 PR-12 because PR-12 is "Lead through dispatcher" — `swt plan` is the user-facing surface of that work) or as small follow-up PRs sharing the milestone's branch. The disposition table is the authoritative per-verb milestone assignment; the per-milestone tables below are the authoritative per-infra-PR list. The two cross-reference; neither subsumes the other.

### 13.1 M1 — Foundation (target: 2 weeks)

**Goal:** Pi integration scaffolded; vendor abstraction proven; methodology layer extracted intact; v2 → v3 path-finding complete.

#### 13.1.1 Entry gate (must hold BEFORE M1 starts)

PR-01a + PR-01b both merged on the v3 branch:

- **PR-01a:** `methodology → codex-driver` edge removed (verified site: `packages/methodology/src/vibe/handlers/bootstrap.ts`). Methodology depends only on `core/abstractions/AgentSpawner`. v2.3.5 test suite still passes with the spawner mocked.
- **PR-01b:** `cli → {codex,claude-code,ollama}-driver` edges removed (verified sites: `packages/cli/src/commands/vibe.ts` imports all three spawners + dispatches on `backend:` config; `packages/cli/src/commands/doctor.ts` imports detectCodexVersion). CLI consumes `core/abstractions/SpawnerEnvironment` (new minimal adapter), not driver-specific imports.

**Post-gate invariant:** `grep -rE "from '@swt-labs/(codex|claude-code|ollama)-driver'" packages/ --exclude-dir={codex,claude-code,ollama}-driver` returns nothing. Until this grep is clean, M1 has not entered.

#### 13.1.2 Deliverables (per PR)

| PR | Subject | Files touched |
|---|---|---|
| PR-01a (entry gate) | Break `methodology → codex-driver` | `packages/methodology/package.json` (remove dep), `packages/methodology/src/vibe/handlers/bootstrap.ts` (replace `writeAgentsMdBlock` import with `AgentSpawner` call), affected tests |
| PR-01b (entry gate) | Break `cli → {codex,claude-code,ollama}-driver` (3 spawner imports in vibe.ts + doctor.ts driver imports) | `packages/cli/src/commands/vibe.ts`, `packages/cli/src/commands/doctor.ts`, `packages/core/src/abstractions/SpawnerEnvironment.ts` (new), affected tests |
| PR-02 | Add `packages/runtime/` skeleton | new directory; `package.json` peerDep on `@earendil-works/pi-coding-agent`; mock impl |
| PR-03 | Add `packages/orchestration/` skeleton | new directory; mock dispatcher; mock worktree manager |
| PR-04 | Add `packages/shared/` | new; consolidate types from `core/types/` + `dashboard-core/schemas/` |
| PR-05 | Delete `codex-driver`, `claude-code-driver`, `ollama-driver` | 3 dirs deleted; root `package.json` deps updated; lockfile regenerated |
| PR-06 | Cassette infrastructure online | `packages/test-utils/cassettes/`; recorder + replayer; one Scout cassette as proof |
| PR-07 | Token meter wired to mock provider | `runtime/meter/`; integration test asserting byte-identical replay |
| PR-08 | Provider quirks scaffold | `runtime/providers/quirks.json` + role-resolver; tier→model map; tests |
| PR-09 | First end-to-end (mocked Pi) | Scout task dispatched through dispatcher → mocked Pi → result harvested |
| PR-10 | Documentation pass | docs/ updated to remove codex references; this TDD2 referenced |
| PR-11 | Make CI test step required | `ci.yml` `continue-on-error: false`; 33 v2.x failures remediated |

#### 13.1.3 Exit gate (verifying M1 complete)

- All unit tests pass for `core/`, `runtime/`, `orchestration/`, `shared/` in isolation (with mocked Pi).
- An integration test dispatches a no-op Scout task through the dispatcher against a cassette and gets back a parsed `TaskResult`.
- `grep -r "codex exec\|@swt-labs/codex-driver\|@swt-labs/claude-code-driver\|@swt-labs/ollama-driver" packages/` returns nothing.
- Token meter records correct input/output/cacheRead/cacheWrite numbers against the cassette (delta = 0 tokens).
- `pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test && pnpm run build` all green on the M1 branch.
- CI matrix green on Linux/macOS/Windows × Node 20/22.
- The dependency graph rule (§4.3) is enforced via ESLint and passes.
- ADRs **Accepted** in M1: ADR-001 (Pi SDK adoption), ADR-002 (Extension result protocol vs invented APIs), ADR-003 (per-provider quirks JSON over TS shims), ADR-004 (cache_control as provider-layer concern), ADR-005 (delete drivers wholesale, no co-existence). ADRs **Proposed** in M1 for later acceptance: ADR-010 (deterministic builds), ADR-011 (provider-matrix cassette-only). See §22.14 for the full index.

#### 13.1.4 Exit-interview checklist

A two-page document the M1 owner fills in at gate review:

- [ ] All exit-gate items verified, with PR links
- [ ] Pi peer-dependency declared correctly in all sub-packages
- [ ] Lockfile regenerated and committed
- [ ] ADRs 001-005 written and reviewed
- [ ] M2 entry conditions confirmed (M2 can start)
- [ ] Risk register updated; new risks discovered during M1 documented
- [ ] Telemetry events for M1 added to the event-registry
- [ ] Documentation reviewed by Vale (no errors)
- [ ] CHANGELOG-v3.md drafted with M1 highlights

#### 13.1.5 Rollback plan

If M1 cannot be completed in 4 weeks (2× the target), the rollback is **not to restore the deleted drivers**, but to:

1. Branch the work to `v3-foundation-deferred`.
2. Cut a v2.4.0 from the v2.3.5 main with only the codex-driver edge breaks (PR-01a + PR-01b).
3. Use v2.4.0 to demonstrate that the architectural debt is gone while Pi adoption is paused.
4. Resume Pi adoption as v3 work when blockers (e.g., Pi API maturity) clear.

#### 13.1.6 Risks (M1-specific)

| Risk | Severity | Mitigation |
|---|---|---|
| Pi API mismatch vs docs | HIGH | TDD2§5 catalogs verified APIs; PR-02's mock impl bridges; PR-07 swaps to real Pi only after cassette is stable |
| Cassette body-hash drift caused by `cache_control` ephemera in requests/responses | MEDIUM | Cassette recorder normalizes `cache_control: {type: 'ephemeral'}` markers (which are deterministic given prompt structure) **before** computing the request body hash; response-side `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` are recorded verbatim and the replayer asserts equality only on first replay (a re-record is the resolution path, not a heuristic match). Documented in §14.7.1. |
| pnpm-lock churn breaks CI | LOW | PR-05 regenerates explicitly; commit the lockfile to the same PR; CI uses `--frozen-lockfile` |
| Methodology tests rely on codex-spawner specifics | MEDIUM | Audit `methodology/test/` before PR-01a; replace any direct codex-spawner imports with the AgentSpawner abstraction's mock |
| 33 v2.x test failures harder to remediate than expected | MEDIUM | Allocate PR-11 explicitly to test debt; if more than 3 days, scope down to "fix or skip-with-ticket" |

### 13.2 M2 — Single-agent path (target: 2 weeks)

**Goal:** End-to-end methodology flow runs on Pi for one provider, no worktrees, no parallel. The TPAC baseline is established.

#### 13.2.1 Deliverables

| PR | Subject |
|---|---|
| PR-12 | Lead role goes through dispatcher (sequential, no parallel) |
| PR-13 | Dev role goes through dispatcher; one task at a time |
| PR-14 | QA role with static-check ladder; LLM escalation working |
| PR-15 | `swt vibe` end-to-end with Pi backend |
| PR-16 | UiPermissionGate lands; routes wired |
| PR-17 | Dashboard SSE consumes Pi events through runtime |
| PR-18 | Cassette regression suite: v2 golden run replays byte-identical (modulo timestamps) |
| PR-19 | First TPAC measurement on the reference repo (M2 baseline) |
| PR-20 | `swt rpc` verb delegating to Pi `runRpcMode` |
| PR-21 | `swt bench` verb prototype |

#### 13.2.2 Reference project for benchmarking

The TPAC reference is a fixed greenfield project: **"hello-world FastAPI service"** with 1 health endpoint, 1 echo endpoint, pytest tests, and a Dockerfile. The methodology runs Scout → Architect (plan) → Dev (1 task) → QA. The token counts are recorded. This project's specification is checked into `packages/test-utils/golden/ref-fastapi/`.

The reference is **frozen**: any change to it requires an ADR and breaks the comparison chain. The intent is that "M2 baseline TPAC" and "M4 −40% TPAC" measure the same scenario.

#### 13.2.3 Exit gate

- Reference greenfield project runs a full milestone end-to-end on Anthropic, producing artefacts byte-identical (modulo timestamps) to a recorded v2.x golden run.
- Regression suite passes (§14.6).
- TPAC measured and recorded as the **fixed baseline** for M4's −40% target.
- Dashboard's existing panels work against the new event stream (visual regression test).

#### 13.2.4 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Phase routing logic was tightly coupled to Codex subprocess return codes | HIGH | Audit `methodology/state/` for `EXIT.NOT_IMPLEMENTED` references; rewrite routing to consume `TaskResult.status` |
| Static-check ladder paths assumed codex's working dir | MEDIUM | Refactor `verification/runner.ts` to take cwd explicitly |
| `swt vibe` UX differences vs v2 | LOW | Pinned beta users; A/B test on a willing subset of v2 users |

### 13.3 M3 — Worktree dispatcher (target: 3 weeks)

**Goal:** Subagent + worktree system online; parallel Dev tasks within a phase; crash recovery verified.

#### 13.3.1 Deliverables

| PR | Subject |
|---|---|
| PR-22 | `worktree-manager.ts` (lifecycle FSM) |
| PR-23 | `claim-registry.ts` (file-claim conflict prevention) |
| PR-24 | `dag-resolver.ts` (depends_on → parallel batches) |
| PR-25 | `lock-files.ts` (PID liveness + crash recovery) |
| PR-26 | `swt_report_result` Extension tool wired |
| PR-27 | Worktrees panel in dashboard |
| PR-28 | Chaos test suite (kill-9 at every transition) |
| PR-29 | `swt cleanup` verb (worktree retention sweep) |
| PR-30 | Cross-OS smoke: Windows worktree path discipline (§9.1.1) |

#### 13.3.2 Exit gate

- A 3-task phase with declared `depends_on` runs as `[T01, T02 parallel], [T03 after both]`, with each task in its own worktree.
- Conflict prevention: an attempted edit outside a task's claim is rejected, logged, and retried with a corrective prompt.
- Crash test (M3 acceptance criterion): SIGKILL the orchestrator mid-phase; restart; phase completes correctly. This runs on Linux + macOS + Windows.
- Wall-clock for the 3-task phase is at least 30% faster than sequential.
- Dashboard's Worktrees panel shows the live state for every active worktree.

#### 13.3.3 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `git worktree` quirks on Windows | HIGH | Dedicated PR-30; ship Win-specific path discipline (§9.1.1); test on real Windows runners |
| Merge conflicts in tested scenarios | MEDIUM | Claim-registry rejects overlapping claims at dispatch time, before any worktree edits |
| Lock-file races on case-insensitive FS | MEDIUM | Use SHA-1 of normalized lowercased path as the lock-file identifier |
| `agent_end` fires before `swt_report_result` finishes | MEDIUM | The defensive harvester (§9.4) writes a placeholder; orchestrator detects and treats as protocol violation |

### 13.4 M4 — Token meter & cache discipline (target: 2 weeks)

**Goal:** Explicit context injection deployed; cache-hit ratio measured high; TPAC −40% vs M2 baseline.

#### 13.4.1 Deliverables

| PR | Subject |
|---|---|
| PR-31 | `buildPrompt()` deterministic context construction (§8.3) |
| PR-32 | Anthropic cache-control breakpoint insertion (§8.2.1) |
| PR-33 | Cache-hit measurement + dashboard panel (§12.3.2) |
| PR-34 | OpenAI auto-cache observation + measurement |
| PR-35 | Budget Gate live (§8.4) + dashboard panel (§12.3.3) |
| PR-36 | TPAC measurement on M2 reference; **must hit −40%** before merge |
| PR-37 | TPAC panel in dashboard (§12.3.5) |
| PR-38 | M4 ADR updates: ADR-006 (cache-control placement), ADR-007 (budget-gate semantics) |

#### 13.4.2 Exit gate

- TPAC measurement on the M2 reference project shows **−40%** vs M2 baseline. Hard requirement; no merge of M4-finish PR otherwise.
- Cache hit ratio panel shows ≥70% on Anthropic runs of the reference project.
- Budget Gate test: configure a low ceiling; verify milestone pauses; dashboard reflects state; resume works.

#### 13.4.3 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Anthropic's cache_control requires minimum 1024 tokens per breakpoint; phases with small artefacts may not qualify | MEDIUM | Fallback: if context block is < 1024 tokens, omit the breakpoint and emit a warning; the methodology fallbacks to non-cached path. Document in ADR-006. |
| TPAC −40% not reachable on first try | HIGH | Spend M4 on diagnostics: which role contributes how much? Use cassette replays to attribute. If physics says we can't hit −40% on this benchmark, document why and propose a refined target (e.g., −30% with strong evidence of marginal returns). |
| Budget gate causes user surprise | MEDIUM | Pause-screen UX is explicit: shows current spend, projected spend, "Resume with $X bump" |

### 13.5 M5 — Multi-provider (target: 2 weeks)

**Goal:** Cross-vendor parallelism; provider fallbacks; provider router strategies fully online.

#### 13.5.1 Deliverables

| PR | Subject |
|---|---|
| PR-39 | OpenRouter shim wired through quirks (GLM, Kimi, DeepSeek, Llama) |
| PR-40 | Optional Gemini shim with ToS warnings |
| PR-41 | Router strategies (pinned, round-robin, tier-routed, cost-optimized) |
| PR-42 | Fallback chain semantics + retry budget shared with Pi `auto_retry_*` events |
| PR-43 | Per-provider cost panel (§12.3.4) |
| PR-44 | Failover simulation tests (mock 503) |

#### 13.5.2 Exit gate

- A 3-task parallel batch runs with each task on a different provider; all complete successfully; result-protocol parses identically across providers.
- Simulate primary-provider outage (mock 503); fallback fires; milestone progresses.
- Per-provider cost panel shows correct attribution against the M4 reference scenario.

#### 13.5.3 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| OpenRouter's response format varies per upstream model | HIGH | Trust Pi's `openai-completions` api type for OpenAI-compat routes; use `streamSimple` for divergent ones via quirks |
| Structured output reliability differs widely across providers | HIGH | Validate every `TaskResult` against the Zod schema at harvest; if validation fails, retry with prompt clarification |
| Cost attribution wrong when fallback fires mid-task | MEDIUM | Per-turn cost tracking; fallback recorded at turn boundary, not retroactively |

### 13.6 M6 — Decommission, benchmark, ship (target: 2 weeks)

**Goal:** v3.0 ships with public benchmark; all v2.x Codex-era code paths fully removed; migration path verified end-to-end.

#### 13.6.1 Deliverables

| PR | Subject |
|---|---|
| PR-45 | All Codex-era code paths verified removed (grep clean) |
| PR-46 | Delete `commands/stubs.ts` after the §3.2.4 disposition table is exhausted (no v3 verb returns `EXIT.NOT_IMPLEMENTED`) |
| PR-47 | Documentation rewrite for vendor-agnostic posture |
| PR-48 | Public benchmark scenario published (reference repo + scripts + result table) |
| PR-49 | `swt migrate --to=v3` migration script with three test fixtures |
| PR-50 | Release notes, CHANGELOG.md, RELEASE-NOTES-v3.0.md |
| PR-51 | All test suites pass: unit, integration, provider matrix, regression, e2e, chaos |
| PR-52 | Vale config + ADR style guide |
| PR-53 | LTS branch cut for v2.3.x (security-only) |

#### 13.6.2 Exit gate (the v3.0 ship gate)

- All v3.0 acceptance criteria from §1.2 met on the public benchmark.
- The migration script successfully upgrades a v2.x `.swt-planning/` to v3 schema without data loss on three test fixtures.
- All P0 dashboard panels green.
- All test suites pass: unit, integration, provider matrix, regression, e2e, chaos.
- v3.0.0 published to npm with provenance.
- The reference benchmark report is on the project's homepage.

#### 13.6.3 LTS policy for v2.x

After v3.0 ships, v2.3.x enters LTS for **6 months**:

- Security patches: backported within 7 days of public disclosure.
- Critical bug fixes (data-loss, install-breaking): backported within 14 days.
- No new features.
- Documentation explicitly states EOL date.

After 6 months: v2.x is archived; users are expected to have migrated or pinned to a specific v2.3.x patch.

### 13.7 Total estimated effort

**~13 weeks of focused work.** Plan for 16 with normal slippage. The biggest unknowns are M1 (cassette infra) and M4 (TPAC −40% may need iteration).

### 13.8 Cross-milestone tracking

A single `.swt-planning/v3-tracking.md` document tracks: PRs merged, ADRs written, TPAC measurements, cache hit measurements, exit-gate signoffs. The dashboard's Milestones panel surfaces this view for the team during the milestone.

---

## 14. Test Strategy

> **Δ from TDD.md§12:** TDD.md§12 named a test pyramid and a cassette concept. TDD2§14 fully specifies: unit, integration, e2e, provider-matrix, regression, cassette, golden, performance, chaos, and static-check layers — each with conventions, structure, examples, coverage targets, and CI integration.

### 14.1 Test pyramid policy

```
                                  /\
                                 /e2\          ~30 tests, ~10 min wall-clock
                                /e2e \
                               /------\
                              / chaos  \       ~50 tests, ~20 min (kill-9 injection)
                             /----------\
                            / provider-mat\    ~60 tests × 6 providers = 360, ~25 min
                           /----------------\
                          /  regression       \   ~40 cassette replays, ~5 min
                         /--------------------\
                        / integration            \  ~200 tests, ~3 min
                       /--------------------------\
                      /  unit                       \  ~2000 tests, ~30s
                     /------------------------------\
```

**Discipline:** every PR adds tests for the code it changes. Reviewers reject PRs that lower coverage by more than 0.5 percentage point on the package being changed.

**Time budgets per layer (CI):**

- Unit: < 30s total
- Integration: < 3 min
- Regression (cassette replay): < 5 min
- Provider matrix: < 25 min (parallelized across 6 jobs)
- Chaos: < 20 min
- E2E: < 10 min
- **Total CI wall-clock target: ≤ 30 min per OS×Node combo**

### 14.2 Unit tests

**Location:** `packages/<name>/test/` (co-located with `src/`).

**Naming:** `*.test.ts` for unit; `*.int.test.ts` for integration.

**Vitest config (per package):**

```ts
// packages/runtime/vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.int.test.ts', 'test/**/*.e2e.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 85, branches: 80, functions: 85 },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
    },
  },
}));
```

**Per-package coverage targets:**

| Package | Lines | Branches | Functions |
|---|---|---|---|
| `core/methodology/` | 90% | 85% | 90% |
| `core/artefacts/` | 95% | 90% | 95% |
| `core/verification/` | 90% | 85% | 90% |
| `core/telemetry/` | 80% | 75% | 80% |
| `runtime/` | 85% | 80% | 85% |
| `orchestration/` | 90% | 85% | 90% |
| `dashboard/server/` | 75% | 70% | 75% |
| `cli/` | 70% | 65% | 70% |
| `shared/` | 95% | 90% | 95% |

The dashboard's client SPA has its own coverage (Solid component tests via @solidjs/testing-library); not in the table above.

**Unit test conventions:**

```ts
// Example: packages/runtime/test/meter/token-meter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTokenMeter } from '../../src/meter/token-meter.js';

describe('TokenMeter', () => {
  let meter: ReturnType<typeof createTokenMeter>;

  beforeEach(() => {
    meter = createTokenMeter({ persist: false });
  });

  it('aggregates input tokens across turns within a task', () => {
    meter.record({ taskId: 'T1', turn: 1, input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
    meter.record({ taskId: 'T1', turn: 2, input: 200, output: 80, cacheRead: 50, cacheWrite: 0 });
    expect(meter.snapshot().byTask['T1'].input).toBe(300);
    expect(meter.snapshot().byTask['T1'].output).toBe(130);
    expect(meter.snapshot().byTask['T1'].cacheRead).toBe(50);
  });

  it('emits METER_UPDATED on every record', () => {
    const listener = vi.fn();
    meter.subscribe(listener);
    meter.record({ taskId: 'T1', turn: 1, input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'METER_UPDATED' }));
  });
});
```

**Conventions enforced:**

- Each test must have at least one explicit `expect`.
- No `it.todo()` without a tracking issue link in the comment.
- No `it.skip()` without a tracking issue link.
- No `beforeAll` for setup that should be per-test (use `beforeEach`).
- No global state between tests (each test owns its setup; no module-level mutables).
- Mocks reset between tests (`beforeEach(() => vi.resetAllMocks())`).

### 14.3 Integration tests

**Location:** `packages/<name>/test/**/*.int.test.ts`.

**Definition:** tests that cross two or more layers (e.g., orchestration → runtime → mocked Pi) but stay inside the monorepo. Integration tests don't hit the network.

**Pi mocking strategy:** integration tests use the mock `AgentSession` from `packages/test-utils/mocks/`. The mock provides scripted responses to `prompt()`; tests assert the event sequence.

```ts
// packages/orchestration/test/dispatcher.int.test.ts
import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../src/dispatcher.js';
import { createMockSession } from '@swt-labs/test-utils/mocks';

describe('Dispatcher (integration with mock session)', () => {
  it('dispatches a Scout task and harvests the result envelope', async () => {
    const mockSession = createMockSession({
      taskId: 'T1',
      scriptedEvents: [
        { type: 'turn_start' },
        { type: 'tool_execution_start', toolName: 'read', /* ... */ },
        { type: 'tool_execution_end', isError: false, /* ... */ },
        // The scripted task calls swt_report_result and returns terminate
        { type: 'agent_end', messages: [/* ... */] },
      ],
      scriptedResult: {
        schema_version: 1, task_id: 'T1', status: 'success',
        summary: 'Found 3 references', files_changed: [],
        must_haves: [{ id: 'MH-1', status: 'passed' }],
      },
    });

    const dispatcher = createDispatcher({ sessionFactory: () => mockSession });
    const result = await dispatcher.dispatch({
      taskId: 'T1', role: 'scout', cwd: '/tmp/wt-T1',
      claims: [], promptContext: /* ... */,
    });

    expect(result.status).toBe('success');
    expect(result.must_haves[0].status).toBe('passed');
  });
});
```

**Integration test coverage targets:**

- Every Layer N ↔ Layer N+1 seam has at least one integration test (per §4.3 there are 5 seams).
- Every CLI verb has at least one integration test exercising its handler.
- Every dashboard route has at least one integration test exercising the handler against an in-process Hono app.

### 14.4 E2E tests

**Location:** `test/e2e/*.e2e.test.ts` at repo root.

**Definition:** the full `swt` binary is spawned as a subprocess; commands run against a real `.swt-planning/` fixture; Pi is mocked at the runtime adapter (no real LLM).

**Why subprocess:** verifies the published bundle works; catches bundling issues; matches user reality.

```ts
// test/e2e/swt-vibe-end-to-end.e2e.test.ts
import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { copyFixture } from '@swt-labs/test-utils';

describe('swt vibe (e2e)', () => {
  it('completes a Scout dispatch end-to-end against a mocked Pi', async () => {
    const fixture = await copyFixture('fixtures/ref-fastapi-empty');
    const result = await execa('node', ['./dist/cli.mjs', 'vibe', '--non-interactive', '--mock-pi'], {
      cwd: fixture.path,
      env: { ...process.env, SWT_MOCK_PI: 'cassette:scout-noop' },
      timeout: 30_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Phase 1.*COMPLETE/);
  });
});
```

**E2E budget: < 10 minutes total.** If we hit > 10 min, we reduce the number of e2e tests (prefer integration coverage); we do not extend the budget.

### 14.5 Provider matrix tests

**Location:** `test/provider-matrix/*.matrix.test.ts`.

**Definition:** the same scenario is replayed against every provider's cassette. Asserts: result envelope is identical (modulo legitimate model differences), token meter is deterministic per provider, cache-hit panel shows expected values.

**Matrix:** `{anthropic, openai, openrouter:deepseek, openrouter:kimi, google, bedrock}` × `{scout-task, dev-task, qa-task}` = 18 tests.

**CI integration:** runs as a separate job `provider-matrix` parallelized across 6 jobs (one per provider).

```ts
// test/provider-matrix/scout-task.matrix.test.ts
import { describe, it, expect } from 'vitest';
import { runScenario } from '@swt-labs/test-utils';

const PROVIDERS = ['anthropic', 'openai', 'openrouter:deepseek', 'openrouter:kimi', 'google', 'bedrock'];

describe.each(PROVIDERS)('Scout task on %s', (provider) => {
  it('produces a valid TaskResult envelope', async () => {
    const result = await runScenario({
      scenario: 'scout-search-codebase',
      provider,
      cassette: `cassettes/scout-${provider.replace(':', '-')}.jsonl`,
    });
    expect(result.status).toBe('success');
    expect(result.must_haves.every(m => m.status === 'passed')).toBe(true);
  });

  it('records deterministic token counts', async () => {
    const r1 = await runScenario({ scenario: 'scout-search-codebase', provider, cassette: '...' });
    const r2 = await runScenario({ scenario: 'scout-search-codebase', provider, cassette: '...' });
    expect(r1.meter).toEqual(r2.meter);
  });
});
```

### 14.6 Regression baseline (v2 golden runs)

**Purpose:** catch unintentional behavior drift vs v2.3.5.

**Approach:**

1. v2.3.5 was used to run the reference fixtures end-to-end; the resulting `.swt-planning/` directories (after a complete milestone) are checked into `packages/test-utils/golden/<fixture>/v2-baseline/`.
2. v3 runs the same fixtures with the same prompts.
3. The regression test compares the resulting `.swt-planning/` against the golden, with allowed diffs (timestamps, session IDs, file paths inside worktrees).

```ts
// test/regression/ref-fastapi.regression.test.ts
import { describe, it, expect } from 'vitest';
import { runMilestone, diffArtefacts } from '@swt-labs/test-utils';

describe('Reference FastAPI milestone (regression vs v2.3.5)', () => {
  it('produces byte-identical artefacts modulo allowed drift', async () => {
    const result = await runMilestone({
      fixture: 'ref-fastapi-empty',
      cassettes: 'golden/ref-fastapi/cassettes/',
    });
    const diff = diffArtefacts({
      actual: result.artefactsPath,
      expected: 'golden/ref-fastapi/v2-baseline/',
      allowedDrift: ['timestamp', 'sessionId', 'worktreePath'],
    });
    expect(diff.violations).toEqual([]);
  });
});
```

**Allowed drift specification (per artefact):**

- `STATE.md`: timestamps in activity log; phase summary text fingerprint must match within Levenshtein distance ≤ 100 chars.
- `phases/NN-slug/plan-NN.md`: task-ID prefixes can change; task content fingerprint must match.
- `phases/NN-slug/qa-NN.md`: timestamps; counts must match exactly.
- Generated artefacts (`scout-briefs/`, `debug-reports/`): fingerprint match (semantic comparison).

The regression suite is the **safety net for the methodology preservation claim** (§11). If v3 silently changes methodology behavior, regression fails.

### 14.7 Cassette infrastructure

**Purpose:** deterministic LLM-response replay for unit + integration + regression tests.

#### 14.7.1 Cassette format

```jsonc
// packages/test-utils/cassettes/<name>.jsonl
// First line: header
{"schema_version":1,"name":"scout-noop","provider":"anthropic","model":"claude-sonnet-4-6","recorded_at":"2026-05-11T14:00:00Z","cwd_redacted":true}
// Subsequent lines: one per HTTP interaction with the provider
{"type":"interaction","seq":1,"request":{"method":"POST","url":"https://api.anthropic.com/v1/messages","headers_normalized":{...},"body_hash":"sha256:..."},"response":{"status":200,"headers":{...},"body_chunks":[{"event":"message_start","data":{...}},{"event":"content_block_start","data":{...}},...]}}
{"type":"interaction","seq":2,...}
```

#### 14.7.2 Recorder

Records a real LLM session into a cassette:

```ts
// packages/test-utils/src/cassettes/recorder.ts
export async function record(opts: { scenario: string; provider: string; outputPath: string }) {
  // Intercept HTTP via undici fetch hooks
  // Normalize: redact cwd, API keys; canonicalize headers
  // Append each interaction as a JSONL line
}
```

The recorder is invoked manually by developers (`pnpm record -- --scenario=scout-noop --provider=anthropic`); it is NOT run in CI. Cassettes are committed to the repo.

#### 14.7.3 Replayer

```ts
// packages/test-utils/src/cassettes/replayer.ts
export function installReplay(cassetteName: string): void {
  // Install a fetch interceptor that:
  //   - Matches incoming requests against the cassette by URL + body hash
  //   - Returns the recorded response stream
  //   - Throws if a request doesn't match (test should be deterministic; mismatches indicate non-determinism bugs)
}
```

The replayer ensures byte-identical replay. If the prompt builder produces a different prompt (e.g., a date snuck in), the body hash differs, and the test fails immediately with a clear error.

#### 14.7.4 Cassette refresh policy

- Cassettes are refreshed when the relevant code changes intentionally (e.g., a prompt edit).
- Refreshes are committed as separate PRs labeled `cassette-refresh`.
- The refresh PR's body must justify the change ("Updated system prompt to mention claims; cassette refreshed.").
- Cassettes are version-controlled with the rest of the repo; they live in `packages/test-utils/cassettes/`.

### 14.8 Golden artefact bundles

**Location:** `packages/test-utils/golden/<fixture>/`.

**Content:**

- `v2-baseline/` — `.swt-planning/` from a v2.3.5 milestone run
- `v3-expected/` — what v3 should produce (initially empty; populated during M2 when the regression test is first written)
- `cassettes/` — the LLM cassettes for each role's dispatch in the milestone
- `inputs/` — the user-input transcripts used to drive the milestone

Each golden bundle is one self-contained scenario for regression testing.

### 14.9 Performance tests (TPAC measurement)

**Location:** `test/perf/*.perf.test.ts`.

**Purpose:** measure TPAC for the M2 baseline and subsequent milestones.

**Methodology:**

1. Use the cassette infrastructure to replay real LLM interactions.
2. The token meter aggregates the recorded usage data.
3. TPAC = total_tokens / acceptance_criteria_count.

```ts
// test/perf/tpac-baseline.perf.test.ts
import { describe, it, expect } from 'vitest';
import { runMilestone } from '@swt-labs/test-utils';

describe('TPAC baseline (M2 reference)', () => {
  it('runs the reference FastAPI milestone and reports TPAC', async () => {
    const result = await runMilestone({
      fixture: 'ref-fastapi-empty',
      cassettes: 'golden/ref-fastapi/cassettes/',
    });
    const tpac = result.meter.totalTokens / result.acceptanceCriteriaCount;
    console.log(`TPAC = ${tpac} tokens / AC`);
    // M2 doesn't enforce a target; M4 will.
    expect(tpac).toBeGreaterThan(0);
    expect(result.meter.totalTokens).toBeGreaterThan(0);
  });
});
```

**M4 enforcement:** the perf test gains an `expect(tpac).toBeLessThanOrEqual(M2_BASELINE * 0.6)` assertion. The M4 PR-36 cannot merge if this fails.

**The `swt bench` verb wraps this** for user invocation:

```bash
swt bench --fixture=ref-fastapi-empty
# Outputs: TPAC = 2,847 tokens/AC (target: 1,708; status: PASS)
```

### 14.10 Chaos tests (crash recovery)

**Location:** `test/chaos/*.chaos.test.ts`.

**Purpose:** verify the M3 gate (resume after `kill -9`).

**Approach:** the test harness spawns the orchestrator as a subprocess. A "killer" coroutine sends SIGKILL after a configurable delay or at a specific event. The harness then spawns a new orchestrator and verifies it resumes correctly.

```ts
// test/chaos/dev-task-resume.chaos.test.ts
import { describe, it, expect } from 'vitest';
import { spawnOrchestrator, killAfterEvent, resumeOrchestrator, finalState } from '@swt-labs/test-utils';

describe('Dev task resume after SIGKILL', () => {
  it('resumes mid-tool-execution', async () => {
    const handle = await spawnOrchestrator({ fixture: 'chaos/single-dev-task' });
    await killAfterEvent(handle, 'tool_execution_start', { taskId: 'T1' });
    const resumed = await resumeOrchestrator({ fixture: 'chaos/single-dev-task' });
    const final = await finalState(resumed);
    expect(final.tasks[0].status).toBe('success');
  });

  it('resumes between turn_end and next turn_start', async () => {
    // ...
  });

  it('detects inconsistent recovery and marks task FAILED with forensics', async () => {
    // Manually corrupt the worktree mid-run; verify the recovery path detects it.
  });
});
```

**Coverage:** at least one chaos test per FSM transition in §9.1 and per orchestrator state transition.

**CI integration:** chaos tests run as a separate job `chaos` due to their longer runtime; budget is 20 minutes.

### 14.11 Static-check ladder (the verification pipeline)

**Per Principle 6, the order is fixed:**

1. `tsc --build` — typecheck (per workspace)
2. `eslint .` — lint
3. `prettier --check .` — format
4. `vitest run` — unit + integration
5. `pnpm test:provider-matrix` — provider matrix
6. `pnpm test:regression` — regression
7. `pnpm test:chaos` — chaos
8. `pnpm test:e2e` — e2e
9. LLM-based QA (in-methodology, not in CI; the methodology's qa-tier orchestration)

Step 9 (LLM QA) only fires from the methodology when steps 1-8 are clean for the relevant scope. The methodology's `verification/runner.ts` enforces this.

### 14.12 Test isolation rules

- **No test creates files outside its temp dir.** Use `vi.mock('node:fs')` or a tempdir helper.
- **No test reaches the network.** The undici fetch interceptor is installed in the global setup and asserts no unintercepted requests fire.
- **No test depends on another test's order.** Tests are run in parallel; ordering dependencies fail in CI.
- **Test fixtures are read-only.** If a test needs to modify a fixture, it copies first to a tempdir.

These rules are enforced by ESLint custom rules + a CI step that runs `vitest --shuffle` to catch ordering bugs.

### 14.13 Coverage reporting

Coverage is generated by `pnpm coverage` (vitest v8 provider). It's uploaded to GitHub Actions artifacts; not to a third-party service (privacy stance from v2 preserved).

The per-package thresholds (§14.2) gate PR merge: a PR that drops coverage below threshold on any package fails CI.

---

## 15. CI/CD Pipeline

> **Δ from TDD.md:** TDD.md§13 (Risk Register) referenced CI/CD as a risk surface but provided no pipeline detail. TDD2§15 is new content: full GitHub Actions YAML, gating policy, secrets management, branch protection, release flow.

### 15.1 Workflow overview

Eight GitHub Actions workflows in `.github/workflows/` (5 preserved from v2 + 3 new in v3):

| Workflow | Trigger | Purpose | v3 status |
|---|---|---|---|
| `ci.yml` | push to main, PR to main | Lint + typecheck + test + build | preserved + tightened |
| `codeql.yml` | PR, weekly | Static security scanning | preserved |
| `install-smoke.yml` | post-release | Install on multiple package managers/OSes | preserved |
| `release.yml` | push to main (when changesets present) | Build + publish to npm | preserved + extended (provenance) |
| `vale.yml` | PR (docs paths) | Documentation style lint | preserved + ADR rules |
| `provider-matrix.yml` (new) | nightly + PR (opt-in label) | Provider matrix tests | NEW |
| `regression.yml` (new) | PR | Cassette replay regression | NEW |
| `chaos.yml` (new) | PR (opt-in) + nightly | SIGKILL injection tests | NEW |

### 15.2 `ci.yml` — full v3 spec

```yaml
name: CI
on:
  push:
    branches: [main, v3-foundation, 'release/*']
  pull_request:
    branches: [main, v3-foundation]
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  preflight:
    name: Preflight checks
    runs-on: ubuntu-latest
    outputs:
      should_run_provider_matrix: ${{ steps.labels.outputs.provider_matrix }}
    steps:
      - uses: actions/checkout@v4
      - id: labels
        run: |
          if [[ "${{ contains(github.event.pull_request.labels.*.name, 'run:provider-matrix') }}" == "true" ]]; then
            echo "provider_matrix=true" >> $GITHUB_OUTPUT
          fi

  build:
    name: ${{ matrix.os }} / Node ${{ matrix.node }}
    runs-on: ${{ matrix.os }}
    needs: preflight
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Lint
        run: pnpm lint
      - name: Format check
        run: pnpm format:check
      - name: Unit + integration tests
        run: pnpm test                                # required in v3
      # NOTE: regression (cassette replay) runs as its own path-gated workflow
      # in regression.yml (§15.4) — not duplicated here. That avoids running the
      # ~5-min regression suite × 6 build-matrix jobs.
      - name: Build
        run: pnpm build
      - name: Bundle size check
        run: node scripts/check-bundle-size.mjs
      - name: Offline check
        run: node scripts/check-offline.mjs

  chaos:
    name: Chaos (kill-9 recovery)
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'run:chaos') || github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:chaos

  e2e:
    name: End-to-end
    runs-on: ${{ matrix.os }}
    needs: build
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:e2e

  provider-matrix:
    name: Provider matrix
    needs: [build, preflight]
    if: needs.preflight.outputs.should_run_provider_matrix == 'true' || github.event_name == 'schedule'
    uses: ./.github/workflows/provider-matrix.yml

  reproducible-build:
    name: Reproducibility check
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'push'              # main + release branches only
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Build twice and diff
        run: |
          pnpm build
          mv dist dist-first
          pnpm build
          # Stable-sort + diff. Any non-determinism (timestamps, hash maps,
          # plugin order) fails the job.
          diff -r dist-first dist
      - name: Upload first build (on diff failure)
        if: failure()
        uses: actions/upload-artifact@v4
        with: { name: dist-first, path: dist-first }
```

The reproducibility job is the CI realization of §17.4's deterministic-build commitment. If a future tsup / TypeScript / pnpm version reintroduces nondeterminism, this job fails on the next push to `main` and CHANGELOG records the regression.

**Branch protection rules (set on `main`):**

- Required status checks: `build (ubuntu-latest / Node 22)`, `build (macos-latest / Node 22)`, `build (windows-latest / Node 22)`, `e2e (ubuntu-latest)`, `CodeQL`, `Vale`.
- Other matrix entries are advisory (failure doesn't block merge but is visible).
- Required reviews: 1; for changes under `packages/runtime/`, 2 (because runtime is the Pi boundary).
- Linear history required (no merge commits).
- Conversations must be resolved.
- Force-push to main: forbidden.
- Branch deletion of main: forbidden.

### 15.3 `provider-matrix.yml` (new)

```yaml
name: Provider Matrix
on:
  workflow_call: {}
  schedule:
    - cron: '0 5 * * *'        # nightly 05:00 UTC

jobs:
  matrix:
    name: ${{ matrix.provider }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        provider:
          - anthropic
          - openai
          - openrouter-deepseek
          - openrouter-kimi
          - google
          - bedrock
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:provider-matrix --filter ${{ matrix.provider }}
        env:
          # API keys are NOT used; cassettes provide the responses
          SWT_MOCK_PROVIDER: ${{ matrix.provider }}
```

The matrix uses cassettes; no real API keys are used in CI. This makes the matrix:
- Deterministic
- Fast
- Free
- Verifiable (cassettes are in the repo)

When intentionally re-recording (cassette refresh PR), the developer uses their own credentials locally.

### 15.4 `regression.yml` (new)

```yaml
name: Regression
on:
  pull_request:
    paths:
      - 'packages/**'
      - 'test/regression/**'
      - 'packages/test-utils/golden/**'
      - 'packages/test-utils/cassettes/**'

jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:regression
      - name: Upload diff report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: regression-diff
          path: test/regression/output/diff-report.html
```

On failure, the HTML diff report between v3-actual and v2-baseline is attached as an artifact for review.

### 15.5 `chaos.yml` (new)

```yaml
name: Chaos
on:
  pull_request:
    types: [labeled, synchronize]
  schedule:
    - cron: '0 7 * * *'        # nightly 07:00 UTC

jobs:
  chaos:
    if: github.event_name == 'schedule' || contains(github.event.pull_request.labels.*.name, 'run:chaos')
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:chaos
```

The chaos job runs nightly on all OSes (Windows worktree path discipline §9.1.1). On PRs, opt-in via label to save CI minutes.

### 15.6 `release.yml` — v3 extensions

```yaml
name: Release
on:
  push:
    branches: [main]

permissions:
  id-token: write       # for npm provenance
  contents: write       # for tags and CHANGELOG commits

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org/'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Import GPG signing key
        id: gpg
        uses: crazy-max/ghaction-import-gpg@v6
        with:
          gpg_private_key: ${{ secrets.GPG_PRIVATE_KEY }}
          passphrase:      ${{ secrets.GPG_PASSPHRASE }}
          git_user_signingkey: true
          git_tag_gpgsign: true              # `git tag` becomes `git tag -s` implicitly
      - name: Create release PR or publish
        id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm release
          createGithubReleases: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN:    ${{ secrets.NPM_TOKEN }}
          # changesets-action defers to `git config tag.gpgsign=true` (set by the
          # import step above), so its auto-tag is signed without further action.
      - name: Verify release tag was signed
        if: steps.changesets.outputs.published == 'true'
        run: |
          TAG="v${{ fromJSON(steps.changesets.outputs.publishedPackages)[0].version }}"
          git verify-tag "$TAG"
```

**Provenance** (via npm `--provenance` flag through the `publish` script) creates a Sigstore-attested provenance file linking the npm tarball to the GitHub Actions run. This is npm's recommended supply-chain provenance mechanism.

**Signed tags** are required for each release; the `release` workflow uses a GPG key stored in GitHub Actions secrets.

### 15.7 Bundle size budgets

```js
// scripts/check-bundle-size.mjs (excerpt)
const BUDGETS = {
  'dist/cli.mjs':                     { max_bytes: 800_000, warn_at: 700_000 },
  'packages/dashboard/dist/server.mjs': { max_bytes: 600_000, warn_at: 500_000 },
  'packages/dashboard/dist/client/index.html': { max_bytes:  20_000 },
  'packages/dashboard/dist/client/assets/index.js': { max_bytes: 1_000_000, warn_at: 850_000 },
};
```

CI fails if any bundle exceeds `max_bytes`; warns if it exceeds `warn_at`. Budgets are tracked in the PR description for any size-increasing changes.

### 15.8 CodeQL

The existing `codeql.yml` from v2 is preserved. v3 adds:

- Additional queries from `github/codeql/javascript/ql/src/Security/`
- A custom query for the new "no Pi import outside runtime/" rule (defense-in-depth alongside ESLint)

### 15.9 Vale

The existing `vale.yml` is preserved. v3 adds rules:

- `ADR-001`: ADR documents must follow the template (Title, Context, Decision, Consequences).
- `Verified-Status`: every "VERIFIED" / "ASSUMED" / "OPEN" tag in TDD2 must be followed by a citation or footnote.
- `Heading-Numbers`: H2-H4 headers in this TDD must have numeric prefixes (§N.M.K).

### 15.10 Install-smoke

Preserved from v2 — runs after each release across `{npm, pnpm, bun} × {ubuntu, macos}` to confirm the published tarball installs and runs `swt --version`.

v3 adds a per-patch matrix entry to catch the v2.3.x-class regressions where a daemon-double-spawn bug shipped despite green CI on the patch.

### 15.11 Secrets and credentials

- `NPM_TOKEN`: scoped to publish; rotated quarterly.
- `GITHUB_TOKEN`: GHA default; permissions explicitly minimal (`id-token: write`, `contents: write` only on release).
- **No LLM provider keys in CI.** Cassettes provide the responses.

### 15.12 CI cost discipline

Total CI minutes per PR (target):

- `build` matrix: 6 jobs × ~10 min = 60 min
- `e2e` matrix: 2 jobs × ~10 min = 20 min
- `regression`: 1 job × ~5 min = 5 min
- `chaos` (opt-in): 3 jobs × ~20 min = 60 min (if label set)
- `provider-matrix` (opt-in): 6 jobs × ~25 min = 150 min (if label set)

Default PR run: ~85 min total wall-clock (parallel). With opt-ins: up to ~295 min. The opt-ins are gated by labels, so the default cost is bounded.

Nightly runs hit all opt-ins; total ~300 min/day.

---

## 16. Observability

> **Δ from TDD.md:** TDD.md didn't have an observability section. TDD2§16 covers structured logging, metrics, traces, and telemetry boundaries.

### 16.1 Structured logging

**Library:** `pino` (already a transitive dep via Hono in v2). v3 standardizes on it across all packages.

**Configuration:** one logger per package, configured at package init:

```ts
// packages/runtime/src/logger.ts
import pino from 'pino';
export const logger = pino({
  level: process.env.SWT_LOG_LEVEL ?? 'info',
  base: { package: '@swt-labs/runtime', version: process.env.SWT_VERSION },
  redact: ['*.apiKey', '*.api_key', '*.authorization', 'headers.authorization'],
  formatters: { level: (label) => ({ level: label }) },
});
```

**Log levels:**

- `trace` (10) — fine-grained debugging; not enabled in production.
- `debug` (20) — diagnostic; enabled by `SWT_LOG_LEVEL=debug`.
- `info` (30) — operational events (default); always enabled.
- `warn` (40) — non-fatal anomalies.
- `error` (50) — fatal errors; user-impacting.

**Output:** `stderr` by default; `stdout` for `swt rpc` mode (stderr is reserved for the RPC log stream by Pi's convention).

**Log destination:** when the dashboard daemon runs, logs go to `.swt-planning/logs/<date>.jsonl` (rotated daily, capped at 50 MB, oldest deleted). The dashboard's Logs panel (M2) shows the tail.

**Redaction:** `pino`'s redact paths strip API keys, OAuth tokens, and Authorization headers. The redaction is tested.

### 16.2 Metrics

The token meter (§8.1) is the primary metric source. Additional metrics:

| Metric | Source | Dimensions | Use |
|---|---|---|---|
| `task_dispatched_total` | orchestrator | role, tier, provider | Throughput |
| `task_completed_total` | orchestrator | status (success/failed/partial/blocked), role | Outcomes |
| `task_duration_seconds` | orchestrator | role, tier (histogram) | Latency |
| `token_input_total` | token meter | provider, model, role | TPAC numerator |
| `token_output_total` | token meter | provider, model, role | TPAC numerator |
| `token_cache_read_total` | token meter | provider, model | Cache hit numerator |
| `token_cache_write_total` | token meter | provider, model | Cache write tracking |
| `cost_usd_total` | cost aggregator | provider, model, milestone | Budget tracking |
| `worktree_active_count` | worktree manager | (gauge) | Concurrency |
| `provider_failover_total` | failover | primary→fallback | Reliability |
| `crash_recovery_total` | orchestrator | outcome (resumed/aborted) | Crash-safety verification |
| `compaction_total` | session wrapper | role | Compaction frequency |

**Format:** Prometheus exposition format at `GET /api/metrics` (new dashboard route in M2, behind an opt-in flag because metrics endpoints have security implications even on loopback).

**No external sink in v3.** Metrics are local-only. Future v3.x may add an opt-in OTLP exporter, but v3.0 is local-only by policy (telemetry boundary §16.5).

### 16.3 Tracing

Per-task spans recorded as journal entries:

```jsonc
// .swt-planning/journal/<date>.jsonl (excerpt)
{"timestamp":"...","type":"span","name":"task.dispatch","task_id":"T1","attributes":{"role":"dev","tier":"balanced","provider":"anthropic"},"duration_ms":12345,"events":[{"name":"prompt.first","at_ms":1230},{"name":"first.tool","at_ms":2540}]}
```

The span format is OpenTelemetry-compatible (the JSON shape can be converted to OTLP later without breaking changes), but no exporter is wired in v3.0.

The dashboard's Trace panel (M3) plots task spans as a Gantt-style chart.

### 16.4 Local dashboards

The Hono dashboard surfaces all observability data. No external Grafana/Prometheus required. The metrics-format-Prometheus endpoint enables users to scrape into their own infrastructure if they want.

The dashboard's "Observability" tab (new in M3) consolidates: Logs, Metrics summary, Cache Hits, Cost, TPAC, Worktrees, Crash Recovery history.

### 16.5 Telemetry boundary

The opt-in telemetry from v2's `packages/telemetry/` is **preserved verbatim**. It sends:

- Anonymous installation ID
- Anonymized event names (no payloads)
- Version + OS

It does NOT send: file paths, source code, prompts, LLM responses, API keys, project names.

The opt-in flag lives in `.swt-planning/config.json#telemetry.enabled` (default: `false`). Users opt in via `swt config telemetry.enabled true`.

The telemetry sink is the project's own collector (URL in `core/telemetry/http-sender.ts`); users can override with `SWT_TELEMETRY_URL=...` to send to their own collector or to disable via `SWT_TELEMETRY_URL=off`.

**v3 additions to the event registry:**

- `swt.v3.task_dispatched` (no payload beyond role)
- `swt.v3.task_completed` (status only)
- `swt.v3.crash_recovered` (yes/no)
- `swt.v3.budget_paused` (yes/no)
- `swt.v3.provider_failover` (yes/no)

No metric values, no times, no costs — just incident counts. The full schema is in `packages/core/telemetry/events.ts`.

---

## 17. Release Process

> **Δ from TDD.md:** TDD.md mentioned changesets briefly; TDD2§17 specifies the release flow end-to-end including rollback and LTS.

### 17.1 Versioning policy

**Semantic versioning** per https://semver.org/spec/v2.0.0.html:

- **MAJOR** for breaking changes to the public API (CLI flags, on-disk `.swt-planning/` schema, npm package exports).
- **MINOR** for additive features (new CLI verbs, new dashboard routes, new dashboard panels).
- **PATCH** for bug fixes and internal refactors that don't affect the public API.

**Pre-release labels:**

- `next` for canary builds (auto-published from `main`).
- `rc.N` for release candidates.
- `beta.N` for beta milestones.

**v3.0 launch sequence:**

```
3.0.0-alpha.1   (M1 close)
3.0.0-alpha.2   (M2 close)
3.0.0-beta.1    (M3 close)
3.0.0-rc.1      (M5 close)
3.0.0-rc.2      (M6 PR-43 close)
3.0.0           (M6 ship)
```

### 17.2 Changesets workflow

The v2 changesets configuration is preserved. PRs that change `packages/**` MUST include a changeset:

```bash
pnpm changeset
# Choose packages affected; bump type per package; describe the change
```

Changesets accumulate in `.changeset/*.md` until the release workflow processes them:

- For non-main pushes: changesets queue.
- For main pushes: changesets-action either creates a "Release PR" or, if a Release PR is already merged, publishes to npm.

The Release PR is the human review surface: a maintainer reads it, confirms the bumps are correct, and merges. Auto-merge is NOT enabled for the Release PR; this is intentional.

### 17.3 Release candidates

For `MAJOR` releases (and for the v3.0 launch specifically):

1. Cut a `release/3.0` branch from main.
2. Tag `v3.0.0-rc.1` and publish to npm under the `next` tag.
3. Wait 7 calendar days. Receive feedback. Fix issues on `release/3.0`. Tag `rc.2` etc.
4. After two RCs with no critical bugs, promote to stable.
5. Stable release: tag `v3.0.0`, publish to npm under `latest` tag.

**Release-candidate dashboard:** the dashboard renders an "RC notice" banner when the user is running a non-stable version, with a feedback link.

### 17.4 Provenance and signed tags

**npm provenance** (§15.6): every published tarball has a Sigstore-attested provenance file. Verifiable via `npm view stop-wasting-tokens dist.attestations.provenance`.

**Signed tags:** every release tag is GPG-signed with the maintainer's key (`GPG_PRIVATE_KEY` GitHub secret). Verification command published in the release notes: `git verify-tag v3.0.0`.

**Reproducible builds:** v3 commits to deterministic builds. Two runs of `pnpm install --frozen-lockfile && pnpm build` on the same commit produce byte-identical `dist/` outputs. CI asserts this via a "reproducibility check" job that builds twice and diffs.

### 17.5 Rollback plan

If a published version has a critical defect:

1. **Within 24 hours of publish:** `npm unpublish stop-wasting-tokens@X.Y.Z` (allowed within 72 hours; we use within 24 to be safe).
2. **After 24 hours:** `npm deprecate stop-wasting-tokens@X.Y.Z "Critical bug; upgrade to X.Y.Z+1"`. Defective version stays published but warns on install.
3. **Communication:** open a pinned issue on GitHub explaining the defect, the workaround, and the fix-up version timeline. Post to the announcement channel (if any).
4. **Forward fix:** cut a `X.Y.(Z+1)` patch immediately. Backport the fix to LTS branches.

**Rollback decision criteria:** a critical defect is one that:

- Causes data loss (corrupted `.swt-planning/`).
- Blocks installation (`npm install` fails).
- Exfiltrates secrets (API keys in logs, telemetry, etc.).
- Bypasses the permission gates.

Less-critical defects: a regular patch is sufficient; no unpublish/deprecate.

### 17.6 LTS policy for v2.x

After v3.0 ships, v2.3.x enters LTS for **6 months from the v3.0 release date**:

| Issue class | LTS treatment | Backport SLA |
|---|---|---|
| Security (CVE, RCE, secret leak) | Patch released | 7 days |
| Data-loss / install-breaking | Patch released | 14 days |
| Regression in core flow | Patch released | 30 days |
| Feature gaps | Not addressed | n/a |
| UX improvements | Not addressed | n/a |

After 6 months, v2.x is **archived**:

- Final patch published.
- README updated to point users at v3.
- Repository tag `v2-archive` pushed.
- GitHub releases for v2 are marked as deprecated.

The LTS branch lives at `release/v2.3-lts` and is the only branch that accepts v2 PRs after v3.0 ships.

### 17.7 Changelog and release notes

**`CHANGELOG.md` is auto-generated** by changesets from the `.changeset/*.md` files. v3.0 introduces a curation layer:

- The auto-generated changelog lives in `CHANGELOG.md`.
- A hand-written `RELEASE-NOTES-v3.0.md` document tells the story of v3 for users: what changed, why, how to migrate. This is the user-facing artifact published with the release.

The v2 launch had a similar split (`CHANGELOG.md` + `RELEASE-NOTES-v1.0.md`); v3 follows the pattern.

### 17.8 Beta program

For v3, an explicit beta program runs from M3 close through v3.0 ship:

- Self-selected beta users install `stop-wasting-tokens@next`.
- A "Beta Survey" route in the dashboard collects opt-in feedback (no telemetry data; just a comment box and a "did v3 break anything?" yes/no).
- Beta feedback is triaged weekly; high-impact items become RC blockers.

The beta program is documented in `docs/beta-program.md` (new in M3).

---

## 18. Documentation Strategy

> **Δ from TDD.md:** TDD.md§14 referenced ADRs; TDD2§18 specifies the full documentation surface and authoring conventions.

### 18.1 In-tree `docs/`

The v2 `docs/` directory has 41 files (verified via `find docs -type f`). v3 reorganizes them into the topical structure below:

```
docs/
├── README.md                      # docs index
├── getting-started.md             # quick start
├── methodology/                   # methodology user guide
│   ├── phases.md
│   ├── roles.md
│   ├── must-haves.md
│   └── qa-tiers.md
├── runtime/                       # runtime/SDK reference
│   ├── pi-integration.md          # NEW: pointers to Pi docs + our integration
│   ├── extensions.md              # NEW: how Pi extensions work in SWT
│   ├── providers.md               # NEW: provider configuration
│   └── caching.md                 # NEW: how cache-control works in v3
├── orchestration/                 # NEW
│   ├── worktrees.md
│   ├── claims.md
│   ├── dag.md
│   └── crash-recovery.md
├── dashboard/                     # NEW
│   ├── panels.md
│   ├── permission-gates.md
│   └── cmd-k.md
├── cli/                           # CLI reference
│   ├── reference.md               # every verb, every flag
│   └── verbs/                     # one file per verb
├── operations/                    # NEW: operating SWT
│   ├── observability.md
│   ├── budget.md
│   ├── failover.md
│   └── migrating-from-v2.md       # the v2→v3 migration guide
├── decisions/                     # ADRs
│   ├── README.md                  # ADR index
│   ├── ADR-001-pi-sdk-adoption.md
│   ├── ADR-002-extension-result-protocol.md
│   ├── ADR-003-quirks-json-over-shims.md
│   ├── ADR-004-cache-at-provider-layer.md
│   ├── ADR-005-delete-drivers-wholesale.md
│   ├── ADR-006-cache-control-breakpoint-placement.md
│   ├── ADR-007-budget-gate-semantics.md
│   ├── ADR-008-worktree-per-task.md
│   ├── ADR-009-windows-worktree-path-discipline.md
│   ├── ADR-010-deterministic-builds.md
│   ├── ADR-011-provider-matrix-cassettes-only.md
│   └── ADR-012-six-month-lts-policy.md
├── design/                        # this TDD lives here in archived form
│   ├── TDD2-v3.0.md               # this document, archived post-ship
│   └── benchmark/                 # public benchmark report
│       ├── methodology.md
│       ├── results.md
│       └── reference-repo.md
└── beta-program.md
```

### 18.2 API reference generation

The existing `scripts/docs-gen.ts` is extended:

- Generates `docs/api/` from package exports' JSDoc.
- Runs in CI; the resulting `docs/api/` is committed (no auto-PR; manual review).
- Output is HTML + markdown side-by-side.

The dashboard's "Docs" tab embeds the rendered markdown.

### 18.3 Migration guide (v2.x → v3.0)

The `docs/operations/migrating-from-v2.md` is the canonical guide. Outline:

1. **What changed at a glance** — a table of v2 concept → v3 concept.
2. **Pre-migration checklist** — verify your `.swt-planning/` is committed; verify your project is on v2.3.5; back up.
3. **Running the migration script:**
   ```bash
   npm install -g stop-wasting-tokens@3
   swt migrate --to=v3
   ```
4. **What the script does** — step-by-step explanation per artefact (per §11.3).
5. **Verification** — run `swt doctor` to verify the migrated project.
6. **Backing out** — git revert the migration commit; reinstall v2.3.x.
7. **FAQ** — known gotchas, common questions.

### 18.4 ADR repository

**ADRs follow the canonical template** (per `docs/decisions/README.md`):

```markdown
# ADR-NNN — Title

**Status:** Accepted | Proposed | Superseded by ADR-MMM

## Context

What is the issue we are seeing motivating this decision?

## Decision

What is the change we are proposing or have agreed to?

## Consequences

What becomes easier or harder because of this change?
```

**Numbering:** sequential, four digits (`ADR-001`, ..., `ADR-9999`). Never renumber; superseding doesn't change the original's number.

**Authoring discipline:**

- Each ADR is ≤ 500 words. Longer means the decision wasn't crisp.
- Each ADR cites its enabling PR.
- Vale enforces the template structure.
- ADRs are committed in the same PR as the code change they justify.

### 18.5 Vale style enforcement

**Existing Vale config preserved.** v3 additions:

- A custom Vale style file `.vale/styles/SWT-ADR.yml` enforces the ADR template.
- A custom Vale rule rejects forbidden words in user-facing docs (e.g., "agent" without context).
- A custom rule enforces "Pi" capitalization (never "PI" or "pi" except in code).

### 18.6 Public documentation site

v3.0 ships with **no** public hosted documentation site. The README on GitHub + `docs/` in-tree is sufficient. If a docs site becomes needed (post-1000-users), it would be auto-generated from `docs/` by an MkDocs or Docusaurus build, not hand-maintained.

This decision is captured in **ADR-013 (deferred until needed): public documentation site posture**.

### 18.7 The TDD lifecycle

This TDD2 itself follows a lifecycle:

- **Draft** (current): under review; subject to change.
- **Accepted**: after maintainer sign-off; baseline for v3 work.
- **Living**: incrementally amended via PR for the duration of v3 development.
- **Archived**: at v3.0 ship, copied to `docs/design/TDD2-v3.0.md` with frozen content; future TDD3 begins for the next major.

ADRs accumulate during the Living phase. The Archived TDD + the ADR set comprise the historical record of v3.

---

## 19. Risk Register

> **Δ from TDD.md§13:** TDD.md§13 listed ~8 risks. TDD2§19 expands to 24, each with severity, probability, impact, mitigation, and owner. Risks are tracked in the dashboard's Risks panel and reviewed at each milestone gate.

The register uses a 3×3 matrix: Severity {Low, Medium, High} × Probability {Low, Medium, High}. The product is the priority score (1-9).

### 19.1 Architectural risks

| # | Risk | Severity | Prob | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-01 | Pi API surface shifts pre-1.0; published exports remove or rename what we depend on | H | M | 6 | Runtime adapter localizes Pi usage to ~10 files; peer-dep ranges allow upgrade signal early; CI tests against `next` Pi tag nightly. **M1 update (post-PR-09):** Pi 0.74-alpha shifted types across patch releases; runtime/src/extensions/pi-types.ts now declares structural mirrors of `ExtensionAPI` + `ExtensionContext` capturing only the methods SWT uses, encoding the ADR-002 invariant at the type level. Collapses to a thin re-export when Pi ships a 1.0 stable type surface. | runtime owner |
| R-02 | codex-driver edges have more dependencies than visible at edge-level (either in methodology or CLI) | M | M | 4 | M1 PR-01a and PR-01b each produce a complete `grep -rE "from '@swt-labs/codex-driver'"` audit before merge; methodology + CLI test suites catch missed imports | core owner |
| R-03 | TPAC −40% physically not achievable on the M2 reference scenario | H | M | 6 | M4 includes a contingency: if −40% requires unbounded engineering, document why with cassette diffs and propose a refined target (−30% with clear evidence) | runtime owner |
| R-04 | Anthropic changes cache_control behavior (e.g., min-token threshold doubles) | M | L | 2 | Fallback: prompt-builder emits cache_control conditionally on token count; warning surfaces in dashboard | runtime owner |
| R-05 | git worktree on Windows produces path-length or case-sensitivity bugs | H | M | 6 | Dedicated PR-30; cross-OS chaos tests; path discipline §9.1.1 | orchestration owner |
| R-06 | Pi extensions interact in unexpected ways at scale (10+ registered tools/providers) | M | L | 2 | Limit SWT extensions to the minimum (3-4); test extension ordering explicitly | runtime owner |
| R-07 | Provider's structured output format varies enough that result-protocol parsing fails | M | M | 4 | Validate every TaskResult against Zod at harvest; retry with clarification prompt on parse failure; budget includes a "parse-retry" allowance | orchestration owner |
| R-08 | Claim registry deadlocks when two tasks have mutually exclusive partial overlap | L | L | 1 | Claims are append-only; the registry serializes overlapping claims, not deadlocks; tested with adversarial fixture | orchestration owner |

### 19.2 Implementation risks

| # | Risk | Severity | Prob | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-09 | The 33 v2.x test failures take longer than 3 days to remediate | M | M | 4 | Time-box PR-11; failures that can't be fixed in time get `it.skip` with a tracking issue, not `continue-on-error` | qa owner |
| R-10 | Cassette infrastructure produces flaky tests due to non-deterministic HTTP body ordering | M | M | 4 | Hash interactions by canonical body (sorted keys); refusing to record cassettes with non-deterministic responses | test-utils owner |
| R-11 | Dashboard SSE consumers can't handle the v3 event volume (more events per task) | M | L | 2 | Event throttling per consumer; SSE keep-alive tuned; new "events per second" metric in dashboard | dashboard owner |
| R-12 | Hono+Solid+SSE bundle size exceeds budget after dashboard panel additions | M | L | 2 | Bundle-size budgets in CI (§15.7); lazy-load new panels via Solid lazy() | dashboard owner |
| R-13 | Cross-OS file-watching produces different event timings, breaking snapshot tests | M | M | 4 | Snapshot tests use chokidar's `awaitWriteFinish` + an explicit settle delay; Windows-specific test path | dashboard owner |
| R-14 | The `swt migrate --to=v3` script corrupts an edge-case `.swt-planning/` | H | L | 3 | Three fixture test cases per PR-49; migration is opt-in via flag; backup is recommended in the migration guide | cli owner |
| R-15 | Token meter undercounts when Pi `auto_retry_*` events fire | M | L | 2 | Subscribe to retry events explicitly; deduplicate token counts by `(task_id, turn, attempt)` triple | runtime owner |

### 19.3 Project risks

| # | Risk | Severity | Prob | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-16 | The 13-week estimate slips beyond 20 weeks | M | M | 4 | Milestone gates are hard; if M1 isn't done in 4 weeks, the rollback plan §13.1.5 fires | tech lead |
| R-17 | Pi adoption causes a license-compat issue (e.g., AGPL transitive) | H | L | 3 | License audit at M1 PR-01; npm `--license` filter in CI | tech lead |
| R-18 | v2.3.x security CVE during v3 development reroutes engineering capacity | M | M | 4 | LTS policy is preserved; v3 work pauses for ≤7 days to ship the CVE patch | tech lead |
| R-19 | A beta user finds a critical defect just before v3.0 ship | M | M | 4 | The two-RC policy + beta program (§17.3, §17.8); critical defect blocks ship until patched in an RC | tech lead |
| R-20 | Anthropic / OpenAI deprecate models we depend on mid-development | L | M | 2 | Tier-based abstraction (§7.1) — model swaps are config changes, not code changes; quirks.json updated | runtime owner |

### 19.4 Operational risks (post-launch)

| # | Risk | Severity | Prob | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-21 | Users hit unexpected costs because the budget gate didn't pause aggressively enough | M | L | 2 | Conservative defaults (`milestone_ceiling: $50`); pre-flight cost estimator (`swt bench --estimate`) | runtime owner |
| R-22 | Reproducibility benchmark numbers drift over time as providers change pricing | L | H | 3 | Benchmark report republished monthly with each provider's stated rate; comparison still uses our own meter | docs owner |
| R-23 | Migration script bug discovered after a user has already migrated; their data is lost | H | L | 3 | Script writes `.swt-planning.v2-backup/` before migration; restore script ships in same release | cli owner |
| R-24 | Pi has a CVE that affects SWT users | H | L | 3 | Pi peer-dep range narrowed in patch releases when needed; advisory channel monitored | tech lead |

### 19.5 Risk-review cadence

- **Per-PR:** PR author considers if their change touches any risk; updates score if material.
- **Per-milestone gate:** all risks reviewed; closed/promoted/added; documented in milestone exit interview.
- **Post-launch quarterly:** operational risks reviewed; sunset risks no longer applicable.

The risks live in `docs/risks.md` as the canonical register; the table above is a snapshot for TDD2's archive.

### 19.6 M1 exit-interview risk delta

Tracked per the cadence above: every milestone gate updates this subsection (or `19.7 M2 …`, etc., when the next milestone closes). M1 closed with the following deltas relative to the pre-execution snapshot:

- **R-01 (Pi API surface):** mitigation enriched in-place — Pi 0.74-alpha type instability was real during execution; resolved by the structural-mirror pattern in `runtime/src/extensions/pi-types.ts` (per PR-09 + ADR-002). Score unchanged (still 6); the mitigation is now codified rather than aspirational.
- **R-02 (codex-driver edge audit):** **CLOSED.** Plan 01-01 PR-01a + PR-01b each shipped the verified grep audit before merge; Plan 01-02 PR-05 deleted the three driver packages wholesale per ADR-005. The grep invariant `from '@swt-labs/(codex|claude-code|ollama)-driver'` returns nothing on `v3-foundation`. Risk no longer applies.
- **R-09 (33-test remediation overrun):** **IN PROGRESS at Plan 01-03 PR-11 Task A.** Tracked in `docs/decisions/test-debt-tracking.md`. Score stays at 4 until PR-11 Task A merges; promotes to **CLOSED** then.
- **R-10 (cassette flakiness):** mitigation already implemented in Plan 01-02 PR-06 — canonical-body SHA-256 hashing (`packages/test-utils/src/cassettes/normalize.ts`) + sealed-cassette enforcement (`cwd_redacted: z.literal(true)` in `format.ts`). Score stays at 4 until the cassettes are recorded and the byte-identical assertion passes; promotes to **CLOSED** then.

**No new architectural-class risks surfaced during M1 execution.** Three operational discoveries are tracked outside the risk register:

- The VBW pre-push hook bug (issue #635) — external tooling defect, resolved upstream as VBW v1.37.1 + locally via the `--verify` short-circuit in `scripts/bump-version.sh`. Not a v3 architectural concern.
- The VBW file-guard exact-match behaviour — internal-workflow friction that drove the per-file `files_modified` expansions documented in each plan's deviations. Plan-amendments accepted; no upstream change requested.
- Two cassette recordings deferred to a user-driven session — tracked in `.vbw-planning/STATE.md ## Todos` and `.vbw-planning/v3-tracking.md`; activates the two cassette-gated tests on commit. Not a risk per se since the alternative tests (synthetic-entries + placeholder-passing) keep CI honest in the interim.

---

## 20. Decision Log

> **Δ from TDD.md§14:** TDD.md§14 was a stub. TDD2§20 lists the major decisions made in producing TDD2 with their rationale.

| # | Decision | Date | Rationale | ADR |
|---|---|---|---|---|
| D-01 | Adopt `@earendil-works/pi-coding-agent` as the runtime substrate | 2026-05-11 | Owns the runtime; vendor-agnostic; mature enough for v3 work | ADR-001 |
| D-02 | Implement result protocol via Extension custom tool, not the (non-existent) `report_result` | 2026-05-11 | Pi docs don't show `report_result`; Extension API gives us the contract we need with documented primitives | ADR-002 |
| D-03 | Provider quirks live in one `quirks.json` consumed by one extension, not per-provider TS files | 2026-05-11 | Pi already supports 25+ providers natively; per-provider TS files would invite bit rot | ADR-003 |
| D-04 | Cache-control breakpoints live at the provider-shim layer, not Pi-level | 2026-05-11 | Pi has no native cache_control API; cache is inherently provider-specific | ADR-004 |
| D-05 | Delete `codex-driver`, `claude-code-driver`, `ollama-driver` wholesale; no co-existence | 2026-05-11 | TDD.md decision preserved; co-existence multiplies surface area and obstructs the methodology IP | ADR-005 |
| D-06 | Cache-control placement: after artefact block, before task-specific content | 2026-05-11 | Maximizes cache hit on the role-stable prefix; meets Anthropic ≥1024-token minimum | ADR-006 |
| D-07 | Budget Gate downgrades tier at 70%, pauses at 95% | 2026-05-11 | Empirically chosen thresholds; configurable per-project | ADR-007 |
| D-08 | One worktree per dispatched task | 2026-05-11 | Per-task isolation enables parallelism, simplifies claims, simplifies crash recovery | ADR-008 |
| D-09 | Windows worktree path discipline: POSIX paths internally, 200-char cap, force LF | 2026-05-11 | Avoids documented git-worktree-on-Windows issues; cross-OS chaos tests verify | ADR-009 |
| D-10 | Deterministic builds: byte-identical `dist/` outputs from the same commit | 2026-05-11 | Supply-chain hygiene; reproducibility check in CI | ADR-010 |
| D-11 | Provider matrix tests run on cassettes only; no real API keys in CI | 2026-05-11 | Determinism, speed, cost; refresh process governs cassette evolution | ADR-011 |
| D-12 | LTS policy: 6 months of security + critical-bug patches for v2.3.x | 2026-05-11 | Bridges the gap for users who can't migrate immediately; explicit EOL | ADR-012 |
| D-13 | Single CLI binary path preserved at `./dist/cli.mjs` | 2026-05-11 | Avoids churn for downstream consumers; muscle memory | (no ADR; preserves v2) |
| D-14 | The `methodology → codex-driver` edge break is the M1 entry gate, not exit | 2026-05-11 | Removes architectural debt before Pi work begins; ensures the methodology layer is genuinely vendor-agnostic going forward | ADR-001 |
| D-15 | `swt rpc` verb delegates to Pi `runRpcMode` with no protocol modification | 2026-05-11 | Pi's RPC is good; wrapping adds value only by branding it as `swt` for tooling that expects one binary | (no ADR) |
| D-16 | Dashboard remains localhost-only; no hosted version | 2026-05-11 | Matches v2 scope; cloud features are v4 work | (no ADR; preserves v2) |
| D-17 | `swt bench` is the canonical TPAC measurement entry point | 2026-05-11 | Standardizes the measurement; reproducible across users | (no ADR; tooling decision) |
| D-18 | Cassette format v1 freezes at M1 ship; format changes require explicit version bump | 2026-05-11 | Avoids cassette compatibility breakage; refresh path is well-defined | (no ADR; testing decision) |
| D-19 | The role's tool subset is enforced at session creation, not in the prompt | 2026-05-11 | Defense-in-depth: even if the prompt is bypassed, tools aren't available; matches Principle 4 | (no ADR; obvious) |
| D-20 | All metrics endpoints are local-only in v3.0; OTLP exporter deferred to v3.x | 2026-05-11 | Telemetry boundary in v3.0 is unchanged from v2; pushing metrics is a separate decision | (no ADR; preserves v2 stance) |

---

## 21. Open Questions

The following are unresolved and need decisions during M1-M2:

### 21.1 Architecture

| # | Question | Default if not decided | Decision target |
|---|---|---|---|
| Q-01 | Should the orchestrator's lock file include a hash of the orchestrator's binary version, refusing to resume after a version change? | yes (refuse to resume cross-version) | M3 PR-25 |
| Q-02 | When a worktree's git state is dirty after a crash, do we auto-stash or auto-discard? | auto-stash to `.swt-planning/parallel/wt-<id>/.crash-stash/` | M3 PR-25 |
| Q-03 | Do we ship `swt rpc` in M2 or defer to v3.1? | M2 (per current TDD2) | M2 PR-20 review |
| Q-04 | How aggressive should the auto-fallback be on Pi's `auto_retry_end` with `success: false`? | retry once on next provider | M5 PR-42 |

### 21.2 User experience

| # | Question | Default | Decision target |
|---|---|---|---|
| Q-05 | Should `swt vibe` in non-interactive mode print all events to stdout or only the summary? | summary, with `--verbose` for full event stream | M2 PR-15 |
| Q-06 | Should the dashboard prompt for confirmation when a Phase has > $5 estimated cost? | yes, behind opt-in flag | M4 PR-35 |
| Q-07 | Should `swt migrate --to=v3` be interactive (prompt at each step) or fully automatic? | automatic with `--dry-run` flag | M6 PR-49 |

### 21.3 Operations

| # | Question | Default | Decision target |
|---|---|---|---|
| Q-08 | Where do `.swt-planning/parallel/` worktree leftovers go after `swt cleanup`? | `.swt-planning/parallel/.archived/` for 7 days, then deleted | M3 PR-29 |
| Q-09 | Are journal files committed to git or `.gitignore`'d? | `.gitignore`'d (operational, not source) | M1 PR-04 |
| Q-10 | Does the budget state persist across `swt` sessions or reset per session? | persist (it's the budget for the milestone, not the session) | M4 PR-35 |

### 21.4 Release

| # | Question | Default | Decision target |
|---|---|---|---|
| Q-11 | Does v3.0 launch with an `npx swt-v3-migrate` standalone migrator, or only `swt migrate`? | `swt migrate` only; the standalone is `npx stop-wasting-tokens migrate` | M6 PR-49 |
| Q-12 | Public benchmark on Anthropic only, or also OpenAI? | both, side-by-side; this is part of the "vendor-agnostic" story | M6 PR-48 |

Each open question gets a resolution PR before its decision target milestone closes.

---

## 22. ADR Seeds

Skeletons for the 13 ADRs referenced throughout TDD2. ADR-001..005 are **Accepted** (they justify M1's entry-gate decisions and land as drafts in M1 PR-01a/b). ADR-006..013 are **Proposed** and land alongside the PR that realizes the decision.

### 22.1 ADR-001 — Pi SDK adoption

```markdown
# ADR-001 — Pi SDK as the runtime substrate

**Status:** Accepted

## Context

SWT v2.x runs methodology over the Codex CLI as a subprocess. This worked but
created an architectural ceiling: vendor-coupling, no token meter, no parallelism,
crash-unsafe.

## Decision

Adopt @earendil-works/pi-coding-agent and pi-ai as the runtime substrate for v3.
Delete the Codex/Claude-Code/Ollama driver packages. The methodology layer is
preserved; the runtime layer is replaced.

## Consequences

Easier:
- One runtime to maintain.
- Vendor abstraction comes "free" via Pi's provider catalog.
- Per-task fresh sessions and crash safety enabled by Pi's session model.
- Token meter and cache observability inherent to provider-level integration.

Harder:
- Pi is pre-1.0; we accept API churn risk.
- Some Pi-specific patterns (Extensions, custom tools) need to be learned.
- The methodology→codex-driver edge in v2.3.5 must be broken first.
```

### 22.2 ADR-002 — Extension result protocol

```markdown
# ADR-002 — Result protocol via Extension custom tool

**Status:** Accepted

## Context

TDD.md cited `shouldStopAfterTurn` and `report_result` as Pi primitives. They
don't exist. We need a way for a dispatched agent to:

1. Tell the orchestrator the task is done.
2. Hand off a structured result envelope.
3. Optionally hint that no follow-up LLM call is needed.

## Decision

Use Pi's Extension API to register a `swt_report_result` custom tool. The tool
returns `{terminate: true}` to hint at no follow-up. The tool's execute function
appends a `custom` session entry that the orchestrator harvests after `agent_end`.

A defensive `agent_end` hook writes a placeholder result if the agent ended
without calling the tool.

## Consequences

Easier:
- Uses documented Pi primitives.
- Result envelope is durable on disk (session entry), surviving orchestrator crashes.
- Schema is Zod-validated at the harvest boundary.

Harder:
- One extra extension to load; one extra tool in the role's tool list.
- Agents must learn to call the tool; system prompts include explicit instruction.
```

### 22.3 ADR-003 — Per-provider quirks JSON over TS shims

```markdown
# ADR-003 — Provider quirks live in one JSON file, not per-provider TS shims

**Status:** Accepted

## Context
Pi already supports 25+ providers natively. TDD.md proposed writing per-provider
TypeScript shims at Layer 1; this duplicates Pi's catalog and invites bit rot.

## Decision
Use `packages/runtime/src/providers/quirks.json` as the single overrides file.
One extension (`runtime/extensions/provider-overrides.ts`) applies it via
`pi.registerProvider(...)`. Adding a provider = adding a JSON entry, not a code file.

## Consequences
Easier: one source of truth; no per-file maintenance burden; trivially diffable.
Harder: any quirk that requires arbitrary code (custom `streamSimple`) breaks the
pattern; ADR-003-bis will be authored if/when such a case appears.
```

### 22.4 ADR-004 — Cache_control at provider-shim layer

```markdown
# ADR-004 — cache_control is a provider-layer concern, not a Pi-level one

**Status:** Accepted

## Context
Pi exposes conversation compaction (`session.compact(...)`), but does NOT expose
provider-level prompt caching (Anthropic `cache_control`, OpenAI auto-cache). The
70%-cache-hit target depends on the latter.

## Decision
Implement cache-control breakpoint placement in `packages/runtime/src/cache/`,
keyed by `ProviderModelConfig.api` ('anthropic-messages' → emit breakpoints;
'openai-completions' → trust auto-cache; others → no-op). Pi's compaction stays
on Pi's side, configured per role via §8.5.

## Consequences
Easier: clean concern separation; provider-specific cache logic is testable in
isolation; per-provider cassettes verify per-provider strategies.
Harder: the "≥70% cache hit" claim now lives in §8.2.1; adding a new provider
with novel caching semantics requires its own file under `cache/`.
```

### 22.5 ADR-005 — Delete drivers wholesale; no co-existence

```markdown
# ADR-005 — Delete codex/claude-code/ollama-driver wholesale; no co-existence

**Status:** Accepted

## Context
v2.x had three driver packages. A "v3 with toggleable backends" would multiply
surface area, double the test matrix, and let a methodology→driver edge re-emerge.

## Decision
Delete `packages/{codex,claude-code,ollama}-driver/` wholesale in M1 PR-05. No
re-export shims. Users on Ollama route through Pi's Ollama provider; users on
Claude Code or Codex migrate per §18.3.

## Consequences
Easier: one runtime path to maintain; cleaner mental model; M1 PR-04 deletes
3 packages, ~50 source files, ~20 test files — all auditable.
Harder: v2.x users without Pi-supported providers have nowhere to land; we mitigate
with `swt migrate` (§13.6) and the 6-month LTS (§17.6).
```

### 22.6 ADR-006 — Cache-control breakpoint placement

```markdown
# ADR-006 — Place the Anthropic cache_control breakpoint after artefacts, before task

**Status:** Proposed (lands at M4 PR-32)

## Context
Anthropic requires ≥1024 tokens between cache breakpoints. The cache-hit win comes
from caching the *stable* prefix (role system prompt + project artefacts) and
NOT caching the variable suffix (task brief + must-haves).

## Decision
`buildPrompt` (§8.3) emits blocks in fixed order; the breakpoint goes at
`cacheBreakpointIndex` which is set immediately after the phase context block
and before the task-specific content. Anthropic-only; OpenAI auto-caches.

## Consequences
Easier: the ≥70% cache-hit target becomes mechanical: stable prefix + breakpoint.
Harder: if the artefact prefix drops below 1024 tokens we fall back to no
breakpoint (warning surfaces in the dashboard). Documented in §13.4.3 R-04.
```

### 22.7 ADR-007 — Budget Gate thresholds

```markdown
# ADR-007 — Budget Gate downgrades at 70%, pauses at 95%

**Status:** Proposed (lands at M4 PR-35)

## Context
We need an automated guardrail so a runaway phase doesn't burn the user's monthly
LLM budget. Thresholds need to be aggressive enough to matter but not so eager
they interrupt healthy milestones.

## Decision
Two thresholds (configurable, defaults set here):
- 70% of ceiling → downgrade subsequent dispatches one tier
  (quality → balanced, balanced → cheap-fast)
- 95% of ceiling → pause milestone; require explicit "resume with bump"

## Consequences
Easier: cost surprises become impossible without a deliberate "resume" click.
Harder: bad tier downgrades may produce lower-quality output silently;
the dashboard's Tier panel surfaces every override (§7.2).
```

### 22.8 ADR-008 — Worktree-per-task

```markdown
# ADR-008 — One git worktree per dispatched task

**Status:** Proposed (lands at M3 PR-22)

## Context
Parallel tasks need isolation: file conflicts, untracked artifacts, and partial
edits on crash all become tractable if each task owns its own filesystem.

## Decision
Each task gets `.swt-planning/parallel/wt-<task-id>/` via `git worktree add`.
Pi sessions are created with `cwd: worktreePath`. Tool factories scope
filesystem access to the worktree.

## Consequences
Easier: claim violations rejected at the filesystem boundary; crash recovery
inspects a single directory; parallel batches truly run in parallel.
Harder: git-worktree on Windows requires path discipline (ADR-009); creating
N worktrees has a non-trivial disk cost (~50 MB each for a medium repo).
```

### 22.9 ADR-009 — Windows worktree path discipline

```markdown
# ADR-009 — POSIX-style paths internally; 200-char cap; forced LF line endings

**Status:** Proposed (lands at M3 PR-30)

## Context
git worktree on Windows has three classes of failure: case-insensitive FS
collisions, MAX_PATH (~260 chars), and CRLF/LF mismatch breaking diffs.

## Decision
- All paths stored / compared in POSIX form; converted to Win32 only at
  `child_process.spawn` boundary.
- Worktree paths capped at 200 chars (cwd + task ID); fail fast at creation.
- `.gitattributes` in each worktree forces `eol=lf` for source files.

## Consequences
Easier: the chaos test suite runs on Windows runners without OS-specific skips.
Harder: path arithmetic adds a small abstraction layer; one bug class
(developers writing native paths inadvertently) needs an ESLint rule.
```

### 22.10 ADR-010 — Deterministic builds

```markdown
# ADR-010 — Build outputs are byte-identical from the same commit

**Status:** Proposed (lands at M1 PR-11)

## Context
Supply-chain hygiene + npm provenance both benefit from reproducibility. Two
runs of `pnpm build` on the same lockfile + commit should produce identical
`dist/` outputs.

## Decision
- No `Date.now()` / `process.hrtime()` in build outputs.
- tsup banner / footer customized to omit timestamps.
- pnpm-lock.yaml frozen in CI.
- A `reproducible-build` CI job (§15.2) builds twice and diffs. Failure blocks merge.

## Consequences
Easier: provenance attestations are trustworthy; users can independently verify
that the npm tarball matches the source commit.
Harder: any tool we adopt must be audited for nondeterminism; date-stamped
output requires a feature flag (off in production).
```

### 22.11 ADR-011 — Provider-matrix CI runs on cassettes only

```markdown
# ADR-011 — No real LLM API keys in CI; provider matrix uses cassettes

**Status:** Proposed (lands at M1 PR-06)

## Context
Running the provider matrix against real APIs in CI would be slow ($), nondeterministic
(rate limits + provider drift), and would require storing 6+ API keys in CI secrets.

## Decision
All CI provider-matrix runs use recorded cassettes (§14.7). Cassettes are
checked into `packages/test-utils/cassettes/` and refreshed via labeled PRs.
The recorder uses developer-local API keys; CI uses no keys.

## Consequences
Easier: provider matrix runs in <25 min, deterministically, with zero recurring
cost; no secret-management overhead.
Harder: cassettes can go stale relative to live provider behavior; the cassette-
refresh policy + monthly refresh cadence mitigate (§14.7.4).
```

### 22.12 ADR-012 — Six-month LTS for v2.3.x

```markdown
# ADR-012 — v2.3.x receives 6 months of security + critical-bug patches post-v3.0

**Status:** Proposed (lands at M6 PR-53)

## Context
Users on v2.x can't all migrate to v3 on day one. We need an explicit, time-
bounded support window that doesn't sprawl into "v2 forever".

## Decision
v2.3.x enters LTS on the v3.0.0 release date for 6 calendar months. SLAs:
- Security: 7-day backport. Data-loss / install-breaking: 14-day backport.
  Regression: 30-day backport. Features: not addressed.
After 6 months: final patch + `v2-archive` tag + README pointer to v3.

## Consequences
Easier: maintenance scope is bounded and visible; users have a clear migration
deadline; security obligations are precise.
Harder: 6 months of two-track engineering. The v3 team must staff backport
reviews; v3-only bug fixes that touch shared methodology require careful porting.
```

### 22.13 ADR-013 — Public documentation site posture

```markdown
# ADR-013 — No hosted documentation site at v3.0; in-tree docs/ is sufficient

**Status:** Proposed (deferred until 1000-user threshold)

## Context
A hosted docs site (MkDocs / Docusaurus) adds infrastructure cost, deployment
surface, and another thing to keep current. At v3.0's user scale, GitHub-rendered
markdown is the path of least friction.

## Decision
v3.0 ships with `docs/` in-tree only. If/when user count crosses ~1000, the docs
site is auto-generated from `docs/` by a build step; never hand-maintained.

## Consequences
Easier: one source of truth (the in-tree markdown); no separate hosting bill.
Harder: deep linking + search are weaker than a dedicated docs site offers;
revisit if user feedback flags this.
```

### 22.14 ADR index

**Status lifecycle:** ADRs are **Proposed** when drafted (typically at TDD-time or in the ADR-introducing PR), then promoted to **Accepted** in the PR that implements them (`Status: Accepted` plus the merge SHA recorded in the ADR's frontmatter). The status column below is point-in-time as of 2026-05-11; CI's Vale rule (§15.9) enforces the status field exists on every ADR.

| ADR | Title | Status | Decided | PR |
|---|---|---|---|---|
| 001 | Pi SDK as the runtime substrate | Accepted | 2026-05-11 | M1 PR-01a/b |
| 002 | Result protocol via Extension custom tool | Accepted | 2026-05-11 | M1 PR-01a/b |
| 003 | Per-provider quirks JSON over TS shims | Accepted | 2026-05-11 | M1 PR-08 |
| 004 | Cache_control at provider-shim layer, not Pi-level | Accepted | 2026-05-11 | M1 PR-01a/b |
| 005 | Delete drivers wholesale; no co-existence | Accepted | 2026-05-11 | M1 PR-05 |
| 006 | Cache-control breakpoint placement | Proposed | M4 | M4 PR-32 |
| 007 | Budget gate semantics | Proposed | M4 | M4 PR-35 |
| 008 | Worktree-per-task model | Proposed | M3 | M3 PR-22 |
| 009 | Windows worktree path discipline | Proposed | M3 | M3 PR-30 |
| 010 | Deterministic builds | Proposed | M1 | M1 PR-11 |
| 011 | Provider-matrix tests cassette-only | Proposed | M1 | M1 PR-06 |
| 012 | Six-month LTS for v2.3.x | Proposed | M6 | M6 PR-53 |
| 013 | Public documentation site posture | Proposed (deferred) | M6 | M6 PR-47 |

---

## 23. Appendices

### Appendix A — Verified Pi API quick-reference card

A one-page summary of the Pi SDK API surface used by SWT v3, for fast lookup.

#### A.1 Package exports

```ts
// from @earendil-works/pi-coding-agent
export function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
export function createAgentSessionRuntime(factory: CreateAgentSessionRuntimeFactory, options: RuntimeOptions): Promise<AgentSessionRuntime>;
export class InteractiveMode { /* run(): Promise<void> */ }
export function runPrintMode(runtime: AgentSessionRuntime, opts: PrintModeOptions): Promise<void>;
export function runRpcMode(runtime: AgentSessionRuntime): Promise<void>;
export function defineTool(config: ToolConfig): ToolDefinition;
export const codingTools: AgentTool[];
export const readOnlyTools: AgentTool[];
export function createCodingTools(cwd: string): AgentTool[];
export function createReadOnlyTools(cwd: string): AgentTool[];
export function createReadTool(cwd: string): AgentTool;
export function createBashTool(cwd: string): AgentTool;
export function createEditTool(cwd: string): AgentTool;
export function createWriteTool(cwd: string): AgentTool;
export function createGrepTool(cwd: string): AgentTool;
export function createFindTool(cwd: string): AgentTool;
export function createLsTool(cwd: string): AgentTool;
export class SessionManager { /* inMemory, create, continueRecent, open, list, listAll */ }
export class SettingsManager { /* create, inMemory, applyOverrides, flush, drainErrors */ }
export class AuthStorage { /* create, setRuntimeApiKey */ }
export class ModelRegistry { /* create, inMemory, find, getAvailable */ }
export class DefaultResourceLoader { /* reload, getExtensions, getSkills, ... */ }
export function createEventBus(): EventBus;
export function getAgentDir(): string;
```

#### A.2 Key interfaces

```ts
interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;
  model?: Model;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: Array<{ model: Model; thinkingLevel: ThinkingLevel }>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  tools?: AgentTool[];
  customTools?: ToolDefinition[];
  resourceLoader?: ResourceLoader;
  sessionManager?: SessionManager;
  settingsManager?: SettingsManager;
}

interface AgentSession {
  prompt(text: string, options?: PromptOptions): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  setModel(model: Model): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  compact(customInstructions?: string): Promise<CompactionResult>;
  abort(): Promise<void>;
  dispose(): void;
  // ... see §5.3
}

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
```

#### A.3 Event types

`AgentSessionEvent` discriminated union — 15 types: `message_update`, `message_start`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end`.

`AssistantMessageEvent` delta types: `text_start/delta/end`, `thinking_start/delta/end`, `toolcall_start/delta/end`, `done`, `error`.

#### A.4 Extension API

`pi.on(event, handler)`, `pi.registerTool(def)`, `pi.registerProvider(name, config)`, `pi.registerCommand(name, opts)`, `pi.registerShortcut(shortcut, opts)`, `pi.registerFlag(name, opts)`, `pi.registerMessageRenderer(customType, renderer)`, `pi.sendMessage(msg, {deliverAs})`, `pi.setModel(model)`, `pi.exec(cmd, args)`.

#### A.5 CLI flags

`--mode rpc|json`, `-p|--print`, `-c|--continue`, `-r|--resume`, `--session <path|id>`, `--no-session`, `--session-dir <dir>`, `--provider`, `--model <pattern>`, `--api-key`, `--thinking <level>`, `--models <patterns>`.

### Appendix B — v2.3.5 → v3.0 file migration table

A row per significant v2 file and its v3 fate. Generated from the `.vbw-planning/research/swt-v2-source/` inspection.

| v2 path | v3 path | Action |
|---|---|---|
| `packages/core/src/abstractions/AgentSpawner.ts` | `packages/core/src/abstractions/AgentSpawner.ts` | preserve; impl swapped |
| `packages/core/src/abstractions/HookHost.ts` | `packages/core/src/abstractions/HookHost.ts` | preserve |
| `packages/core/src/abstractions/MemoryStore.ts` | `packages/core/src/abstractions/MemoryStore.ts` | preserve |
| `packages/core/src/abstractions/PermissionGate.ts` | `packages/core/src/abstractions/PermissionGate.ts` | preserve; extended with UiPermissionGate |
| `packages/core/src/abstractions/Prompter.ts` | `packages/core/src/abstractions/Prompter.ts` | preserve |
| `packages/core/src/config/*` | `packages/core/src/config/*` | preserve; new `roles[*].tier` field |
| `packages/core/src/errors/*` | `packages/core/src/errors/*` | preserve; new error classes added |
| `packages/core/src/handoff/*` | `packages/core/src/handoff/*` | preserve |
| `packages/core/src/scaffold/*` | `packages/core/src/scaffold/*` | preserve |
| `packages/core/src/types/*` | `packages/shared/src/types/*` | **migrate** |
| `packages/artifacts/src/*` | `packages/core/src/artefacts/*` | **migrate (renamed)** |
| `packages/methodology/src/*` | `packages/core/src/methodology/*` | **migrate** |
| `packages/methodology/package.json` (codex-driver dep) | (removed) | **delete dep** |
| `packages/cli/src/argv.ts` | `packages/cli/src/argv.ts` | preserve |
| `packages/cli/src/commands/stubs.ts` | (deleted at M6 PR-46) | **dismantle** — see §3.2.4 disposition table; per-verb migration in M2–M6 |
| `packages/cli/src/commands/{config,dashboard,doctor,init,status,update,version,vibe,watch,detect-phase}.ts` | same paths | preserve; internals rewired |
| (new) | `packages/cli/src/commands/{plan,qa,map,debug,archive,pause,audit,assumptions,research,phase,todo,skills,whats-new,uninstall,worktree,lease,cleanup,migrate,rpc,bench}.ts` | **implement** per §3.2.4 stub disposition table + new verbs (§3.2.4 closing) |
| `packages/cli/src/exit-codes.ts` | `packages/cli/src/exit-codes.ts` | preserve |
| `packages/cli/src/router.ts` | `packages/cli/src/router.ts` | preserve |
| `packages/dashboard/src/server/index.ts` | same | preserve; codex factory removed |
| `packages/dashboard/src/server/routes/*` | same paths | preserve; new routes added |
| `packages/dashboard/src/server/vibe/methodology-agent.ts` | same | preserve |
| `packages/dashboard/src/server/vibe/codex-methodology-agent.ts` | (deleted) | **delete** |
| `packages/dashboard/src/server/lib/detect-codex.ts` | (deleted) | **delete** |
| `packages/dashboard-core/src/schemas/*` | `packages/shared/src/schemas/*` | **migrate** |
| `packages/verification/src/*` | `packages/core/src/verification/*` | **migrate** |
| `packages/telemetry/src/*` | `packages/core/src/telemetry/*` | **migrate** |
| `packages/codex-driver/**` | (deleted) | **delete** |
| `packages/claude-code-driver/**` | (deleted) | **delete** |
| `packages/ollama-driver/**` | (deleted) | **delete** |
| `.codex-plugin/**` | (deleted) | **delete** |
| `.github/workflows/ci.yml` | `.github/workflows/ci.yml` | extend (§15.2) |
| `.github/workflows/codeql.yml` | `.github/workflows/codeql.yml` | preserve |
| `.github/workflows/install-smoke.yml` | `.github/workflows/install-smoke.yml` | preserve |
| `.github/workflows/release.yml` | `.github/workflows/release.yml` | extend (provenance, signed tags) |
| `.github/workflows/vale.yml` | `.github/workflows/vale.yml` | preserve; ADR rule added |
| (new) | `.github/workflows/provider-matrix.yml` | NEW |
| (new) | `.github/workflows/regression.yml` | NEW |
| (new) | `.github/workflows/chaos.yml` | NEW |
| `scripts/bump-version.sh` | same | preserve |
| `scripts/check-bundle-size.mjs` | same | extend (new budgets) |
| `scripts/check-offline.mjs` | same | preserve |
| `scripts/docs-gen.ts` | same | extend (benchmark report) |
| `scripts/verify-install.sh` | same | preserve |
| `templates/*` | same | preserve |
| `skills/*` | same | preserve; install path is now `.pi/skills/` |
| `docs/*` | `docs/*` | reorganize per §18.1 |

### Appendix C — Glossary

| Term | Definition |
|---|---|
| **TPAC** | Tokens per shipped acceptance criterion (the north-star metric, §1.2). |
| **Tier** | Capability classification of a model: `cheap-fast`, `balanced`, `quality`, `reasoning`. |
| **Role** | A methodology role (Scout, Architect, Lead, Dev, QA, Debugger). |
| **Worktree** | A git worktree directory at `.swt-planning/parallel/wt-<task-id>/` containing an isolated checkout for parallel task execution. |
| **Claim** | A file path declared by a task as one it may edit; the claim registry serializes conflicting claims. |
| **DAG** | The dependency graph of tasks within a phase, used to batch parallel execution. |
| **Cassette** | A recorded LLM interaction (request + response) used for deterministic test replay. |
| **Golden bundle** | A canonical `.swt-planning/` directory used as the regression baseline. |
| **Must-have** | A requirement that gates phase completion; recorded as `MH-NN` in plans. |
| **Verification ladder** | The fixed-order static-check pipeline: typecheck → lint → format → unit → integration → regression → chaos → e2e → LLM QA. |
| **Methodology** | The methodology IP: phase lifecycle, six roles, must-haves, QA tiers, artefact schemas. Vendor-agnostic by construction. |
| **Runtime adapter** | The thin layer over Pi (Layer 1) that normalizes events, manages cache, meters tokens. |
| **Orchestration** | Layer 2: worktree dispatcher, DAG resolver, claim registry, crash recovery. |
| **Subagent** | A Pi session dispatched by the orchestrator to perform one task in one worktree. Subagents are processes, not LLM features. |
| **Budget Gate** | The token-cost enforcement mechanism with pause/downgrade thresholds. |
| **Cache breakpoint** | A `cache_control: { type: 'ephemeral' }` marker inserted in prompts to enable provider-level caching. |
| **Quirks file** | `runtime/providers/quirks.json` — provider-specific overrides applied via Extension API. |
| **Result protocol** | The `swt_report_result` Extension tool + Zod-validated `TaskResult` envelope. |
| **ADR** | Architecture Decision Record; small documents in `docs/decisions/`. |
| **LTS** | Long-Term Support; v2.3.x gets 6 months of patches after v3.0 ships. |

### Appendix D — Reference repo specification for TPAC benchmark

The TPAC reference is **"hello-world FastAPI service"**, frozen at `packages/test-utils/golden/ref-fastapi/`:

**Repo contents:**

```
ref-fastapi/
├── README.md
├── pyproject.toml
├── src/
│   └── ref_fastapi/
│       ├── __init__.py
│       └── app.py          # 1 health endpoint + 1 echo endpoint
├── tests/
│   ├── __init__.py
│   ├── test_health.py
│   └── test_echo.py
├── Dockerfile
└── .swt-planning/          # initial state — empty milestone declared
    └── ...
```

**Milestone declared in `.swt-planning/ROADMAP.md`:**

> "Add a `/version` endpoint returning the package version from `pyproject.toml`. Must have tests."

This is a deliberately small change: 1 endpoint + 1 test. The methodology dispatches:

- 1 Scout (read pyproject.toml, app.py, test files)
- 1 Architect (1-task plan)
- 1 Dev (implement endpoint + test)
- 1 QA (run tests, type check)

Total: 4 LLM dispatches per milestone. Acceptance criteria: 1 (the version endpoint must return the version).

**Why this scenario:** small enough to run cheaply (~3K tokens at M2 baseline), large enough to exercise the role pipeline, deterministic in its scope.

**Cassettes:** one per role per provider (`{scout,architect,dev,qa}-{anthropic,openai,...}.jsonl`).

**Frozen state:** any change to `ref-fastapi/` (other than the cassette refresh PR pattern) requires an ADR and explicit cassette refresh.

### Appendix E — Changelog of corrections vs TDD.md

| TDD.md location | Original claim | TDD2 correction |
|---|---|---|
| §1.3 | `@mariozechner/pi-coding-agent` namespace | `@earendil-works/pi-coding-agent` (§5.1) |
| §3.1 | "methodology engine is PRESERVED" (implicit clean) | preserved AFTER breaking methodology→codex-driver edge (§11.5, §13.1) |
| §4.1 | 6-layer with no Extension API mention | 6-layer + Pi Extension API as controlled lateral channel (§5.4) |
| §5 | sketches use bare `createSession` | actual is `createAgentSession`; SWT wraps to expose `createSession` locally (§5.2-5.3) |
| §7 | cache_control at Layer 1 as Pi feature | cache_control is provider-layer; lives in `runtime/cache/anthropic-cache.ts` (§8.2.1) |
| §7 | "≥70% cache hit ratio" with no implementation strategy | concrete strategy: deterministic prefix + stable ordering + breakpoint placement + min-1024-token rule (§8.2.1, §8.3) |
| §8 | "shouldStopAfterTurn integration" | Extension `agent_end` hook + tool `{terminate: true}` (§9.4, ADR-002) |
| §8 | "report_result tool wired" | custom tool via Extension API; `swt_report_result` (§9.4) |
| §11 M1 deliverables | "Anthropic + OpenAI shims" | role-resolver + quirks.json overrides; no per-provider TS files (§7.5) |
| §12.4 | "Vitest test suite preserved as regression baseline" | 130 test files in packages/; 2 root tests; full inventory in M1 (§3.5) |
| §5.2 | "single CLI entrypoint at packages/cli/bin/swt.mjs" | preserved at `./dist/cli.mjs` (§6.5) |
| §4 | Layer 0 not specifying peer-dep policy | Pi listed as `peerDependencies: "*"` per Pi docs (§5.1, §6.4) |
| §3.2 | methodology→codex-driver edge undescribed | explicit; M1 entry gate (§3.3, §11.5, §13.1.1) |
| §11 M6 | "all stub CLI verbs deleted" | concrete: `commands/stubs.ts` file deleted (§3.6) |
| §11 M6 | "migration script (`swt migrate --to=v3`)" with no spec | full spec (§11.3 transformations + §13.6 PR-49 + §18.3 guide) |

---

## End of TDD2

This document supersedes `TDD.md`. Material changes to v3 design require a PR amending TDD2 before code lands.

**Sign-off:**

- [ ] Tech lead
- [ ] Methodology owner
- [ ] Runtime owner
- [ ] Orchestration owner
- [ ] Dashboard owner
- [ ] CLI owner
- [ ] Test/QA owner
- [ ] Release engineering

Once all signoffs are recorded, this document is **Accepted** and M1 work begins.







