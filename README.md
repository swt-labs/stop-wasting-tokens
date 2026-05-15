<h1 align="center">STOP WASTING TOKENS</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/stop-wasting-tokens"><img src="https://img.shields.io/npm/v/stop-wasting-tokens.svg" alt="npm"></a>
  <a href="https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml"><img src="https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

---

**AI coding without the waste.** SWT is a spec-driven workflow built around one stubborn obsession: ship quality code while burning the fewest tokens possible. Whether you're vibe-coding a weekend prototype or shipping production systems, the harness keeps your agent honest — no improvising past a documented plan, no goal-drift mid-session, no re-reading your codebase three times in one turn. Same discipline for first-timers and senior engineers; same harness, same outcome.

---

## Quick install

```bash
npm install -g stop-wasting-tokens@next

```

```bash
swt                  # launch Stop-Wasting-Tokens Dashboard
```

v3 ships on npm under dist-tag `next` during prerelease. Detailed install + tutorial: [Install](#install).

---

## Table of contents

- [Install](#install)
- [What "saving tokens" actually means](#what-saving-tokens-actually-means)
- [How SWT works](#how-swt-works)
- [Project status](#project-status)
- [Prerequisites](#prerequisites)
- [Quick start: a real session](#quick-start-a-real-session)
- [The methodology](#the-methodology)
- [Configuration](#configuration)
- [Command reference](#command-reference)
- [Contributing, security, license](#contributing-security-license)

---

## Install

v3 is published on npm under dist-tag `next` while prereleases stabilize. Pick whichever package manager you already use:

```bash
npm install -g stop-wasting-tokens@next
# or: pnpm add -g stop-wasting-tokens@next
# or: bun  add -g stop-wasting-tokens@next
```

Verify the install:

```bash
swt --version        # 3.0.0-alpha.14 (prerelease) or 3.0.0 once stable
swt doctor           # checks Node ≥ 20.18, runtime, .swt-planning/ presence
```

### Migrating from an older SWT or VBW?

- **From SWT v2.x** (Codex CLI backend): run `swt migrate --to=v3` after installing. The script rewrites `.swt-planning/config.json` (drops `backend:`, adds per-role `tier:` + `router_strategy:`, sets `schema_version: 1`) and is verified end-to-end by the Phase 6 boot-clean regression test. Full guide: [`docs/operations/migrating-from-v2.md`](./docs/operations/migrating-from-v2.md).
- **From VBW** (Claude Code plugin): rename `.vbw-planning/` → `.swt-planning/` and re-launch — the methodology contract is preserved verbatim. Step-by-step + breaking-changes reference: [`docs/migration/from-vbw.mdx`](./docs/migration/from-vbw.mdx) and [`docs/migration/step-by-step.mdx`](./docs/migration/step-by-step.mdx).
- **v2.3.x LTS posture:** there isn't one. ADR-012 (six-month LTS) was retracted same-day as v3.0; the supported path is the migration script. Historical v2.3.x tarballs remain on npm if you must pin.

### Set a provider key

SWT routes through whatever provider you have credentials for. Export one of these in your shell rc before the first run:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."          # Anthropic (recommended for cache-discipline gains)
# or:
export OPENAI_API_KEY="sk-..."                  # OpenAI
export OPENROUTER_API_KEY="sk-or-..."           # OpenRouter (25+ providers, one key)
# or run a local model:
export OLLAMA_HOST="http://127.0.0.1:11434"    # Ollama
```

`swt doctor` will tell you which keys it sees and which providers are reachable.

### First run — a 60-second tour

In a fresh directory, scaffold a project and enter the agent loop:

```bash
mkdir my-thing && cd my-thing
swt init my-thing --description "What you're building, in one sentence"
swt vibe
```

`swt vibe` is the orchestrator. On a fresh project it walks you through:

- **Three to five things this project _must_ do** — the discussion engine captures these as `REQUIREMENTS.md` and gates every later phase against them.
- **Your defaults** — `effort` (`thorough` / `balanced` / `fast` / `turbo`), `autonomy` (`cautious` / `standard` / `confident` / `pure-vibe`), `verification_tier` (`quick` / `standard` / `deep`). Persisted to `.swt-planning/config.json` — change later with `swt config set <key> <value>`.
- **Greenfield vs brownfield** — if you ran in an existing repo, Scout maps the codebase into `.swt-planning/codebase/{STACK,ARCHITECTURE,PATTERNS,CONCERNS}.md` once so subsequent agents don't re-grep on every turn.

Once the spec settles, `vibe` automatically routes through the six SDLC roles:

| #   | Role          | What it does                                                                             | Tools     | Thinking      |
| --- | ------------- | ---------------------------------------------------------------------------------------- | --------- | ------------- |
| 1   | **Scout**     | Read-only research over the codebase + ecosystem                                         | read-only | `off` (cheap) |
| 2   | **Architect** | Design + scope decisions; produces `ROADMAP.md` + per-phase plan                         | read-only | `medium`      |
| 3   | **Lead**      | Break the phase into atomic tasks with claims + deps                                     | coding    | `low`         |
| 4   | **Dev**       | Implement each task. One commit per task.                                                | coding    | `low`         |
| 5   | **QA**        | Static-check ladder (typecheck → lint → format → tests) then LLM must-haves verification | qa-bash   | `low`         |
| 6   | **Debugger**  | Escalation for anything Dev can't resolve                                                | coding    | `xhigh`       |

In another terminal, watch the run live:

```bash
swt dashboard            # http://127.0.0.1:43911 — Hono + Solid + SSE
# or:
swt watch                # Ink TUI dashboard in the terminal
```

When the phase passes QA, `vibe` either asks for UAT confirmation or auto-routes to the next phase (depending on your `autonomy` setting). When a milestone is complete:

```bash
swt vibe --archive       # 7-point audit + .swt-planning/milestones/<NN>/ + SHIPPED.md
```

### Troubleshooting the first run

- **`swt doctor` says "no provider keys detected"** — export at least one of the env vars above and reopen your shell.
- **`swt vibe` exits with "No SWT project here"** — you skipped `swt init`. Run it (or `cd` into a directory that already has `.swt-planning/`).
- **You'd rather the dashboard be your primary surface** — run `swt dashboard`; it can drive most of the same routes from the browser.

---

## What "saving tokens" actually means

Token waste in AI coding has five concrete sources. SWT is designed to attack each one:

| Waste source                              | Without SWT                                                             | With SWT                                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Re-reading project context every turn     | Agent re-greps, re-globs, re-reads files it saw 5 minutes ago           | Stable cache-prefix prompts (`cacheBreakpointIndex` per ADR-006); durable `.swt-planning/` artefacts persist between turns             |
| Re-discovering architecture & decisions   | Each session starts cold, re-derives constraints, re-debates trade-offs | `PROJECT.md`, `REQUIREMENTS.md`, `STATE.md` are read once and stay cached for the whole milestone                                      |
| Improvised approaches that get rejected   | Model proposes, you correct, model re-proposes — three turns gone       | Plans are written by Architect/Lead **before** Dev gets the keys; rejected approaches are recorded as deviations                       |
| Goal drift mid-execution                  | "While I was at it, I also refactored…" — the dreaded scope explosion   | Goal-backward QA verifies output against the **specified** plan, not against improvised goals                                          |
| Re-running QA from scratch on small fixes | Full validation matrix every time                                       | Static-check ladder (typecheck → lint → format → tests) short-circuits on first failure; LLM escalation only when a static check fails |

Every design decision in SWT — split prompts, per-role thinking levels, the phase artefact pipeline, the verification ladder, even the file-locking system — is downstream of "minimize tokens spent per shipped acceptance criterion."

---

## How SWT works

In one sentence: **you write a spec, SWT turns it into a plan, six specialist agents execute the plan through a vendor-neutral runtime, and a verification stage compares output to the spec before anything ships.**

```
   You write              SWT turns it into        Six agents execute        Output is verified
   ─────────              ─────────────────        ──────────────────        ─────────────────
   PROJECT.md             ROADMAP.md (phases)      Scout    → research        Static-check ladder
   REQUIREMENTS.md        PHASE/PLAN.md (tasks)    Architect → design         (typecheck → lint
                                                   Lead     → coordinate         → format → tests)
                                                   Dev      → implement       Goal-backward LLM
                                                   QA       → verify            verification on
                                                   Debugger → resolve           failure
```

### Layered architecture (TDD2 §4.3)

A strict dependency direction — methodology never imports vendor SDKs:

```
shared (leaf)
   ↑
core + runtime           ← runtime is the ONLY layer importing @earendil-works/* (Principle 1)
   ↑
orchestration            ← dispatcher + role-router + prompt-builder + worktree-manager
   ↑
dashboard + methodology  ← methodology dispatches THROUGH orchestration
   ↑
cli                      ← the swt binary
```

The vendor coupling lives in exactly one place (`@swt-labs/runtime`); the rest of the codebase is vendor-neutral. Swapping providers is a runtime-layer concern — methodology, orchestration, dashboard, and CLI never see Pi types.

### Six SDLC roles per TDD2 §10.1

Each role has a fixed default tier + tool subset + session mode + thinking level:

| Role          | Default tier | Tool subset | Session mode | Thinking level |
| ------------- | ------------ | ----------- | ------------ | -------------- |
| **Scout**     | `cheap-fast` | read-only   | ephemeral    | `off`          |
| **Architect** | `quality`    | read-only   | ephemeral    | `medium`       |
| **Lead**      | `balanced`   | coding      | persistent   | `low`          |
| **Dev**       | `balanced`   | coding      | ephemeral    | `low`          |
| **QA**        | `balanced`   | qa-bash     | ephemeral    | `low`          |
| **Debugger**  | `reasoning`  | coding      | persistent   | `xhigh`        |

Tier ↔ model mapping is per-provider (declared in `runtime/src/providers/default-tiers.json`); ThinkingLevel is Pi-native vocabulary (`off | minimal | low | medium | high | xhigh`). You don't think about model selection — the methodology does.

---

## Project status

Active development on [`main`](https://github.com/swt-labs/stop-wasting-tokens/tree/main). **v3.0.0-alpha.3 is live on npm under dist-tag `next`** — all 6 milestones structurally complete; prereleases iterate while the cassette-recorded TPAC baseline and public benchmark are captured ahead of the stable cut.

### Milestone progress

| Milestone              | Status                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Foundation          | **CLOSED** 2026-05-12 — 12 PRs across 3 plans / 15 atomic commits. Pi adoption, runtime/orchestration/shared scaffolding, cassette infrastructure, token meter, provider quirks, 13 ADRs, reproducible-build CI.                                                                                                                                                                                               |
| M2 Single-agent path   | **CLOSED** 2026-05-12 — 10 PRs. Methodology dispatches through orchestration; 6 SDLC roles; QA ladder; dashboard SSE; cassette regression; TPAC aggregator; `swt rpc` + `swt bench` verbs. Live TPAC baseline pending user cassette recording.                                                                                                                                                                 |
| M3 Worktree dispatcher | **CLOSED** 2026-05-12 — 4 plans, 9 PRs (Plan 03-01..03-04 + session-wiring + runMilestone follow-ups). `WorktreeManager` FSM, `ClaimRegistry`, `resolveDag`, PID-liveness locks, `swt_report_result` wire-up, real Pi `createSession`, `runVibe` programmatic entry, dashboard Worktrees panel, `swt cleanup` verb, chaos suite, Windows path discipline + ADR-009 Accepted.                                   |
| M4 Token meter + cache | **STRUCTURALLY COMPLETE** 2026-05-12 — 7 of 8 PRs (PR-31..35 + 37 + 38; PR-36 hard-deferred on M2 baseline). Deterministic `buildPrompt`, Anthropic `cache_control` wiring, cache-hit measurement + dashboard CacheHitPanel, OpenAI auto-cache observation, Budget Gate live + BudgetPanel, dashboard TPAC panel, ADR-006 + ADR-007 Accepted. 2 of 3 M4 EXIT GATE criteria PASS; TPAC −40% awaits M2 baseline. |
| M5 Multi-provider      | **STRUCTURALLY COMPLETE** 2026-05-12 — 6 PRs (PR-39..PR-44). OpenRouter shim validation, Gemini ToS warnings, four router strategies (pinned/round-robin/tier-routed/cost-optimized), fallback chain + retry budget, per-provider cost panel, failover simulation, ADR-011 Accepted. 1 of 3 M5 EXIT GATE criteria PASS (failover sim); 2 DEFERRED on user-driven cassette recording.                           |
| M6 Ship                | **STRUCTURALLY COMPLETE** 2026-05-12 — Plan 06-01 closed (PR-45..PR-53). Release operations (public benchmark, homepage update) remain user-driven; npm publish is live (`@next` dist-tag) via the OIDC trusted-publisher flow.                                                                                                                                                                                |

### Test posture at HEAD

- **1150 tests pass / 46 skipped / 0 fail** across the workspace.
- `pnpm typecheck` clean (`tsc --build`).
- `pnpm lint` 0 errors (~303 pre-existing `import/no-restricted-paths` warnings — pnpm-workspace resolver carry-forward).
- `pnpm format:check` clean.
- `pnpm test:chaos` + `pnpm test:provider-matrix` both green.

Per-version changes tracked in [CHANGELOG.md](./CHANGELOG.md). Detailed per-milestone commit trails live in [`.vbw-planning/v3-tracking.md`](./.vbw-planning/v3-tracking.md). Authoritative design: [`TDD2.md`](./TDD2.md). 6-layer architecture: [`docs/architecture.md`](./docs/architecture.md).

---

## Prerequisites

| Tool                                         | Version    | Why                                                                                        |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| **Node.js**                                  | `>= 20.18` | Runtime for the `swt` CLI itself                                                           |
| **A Pi-supported provider**                  | —          | Anthropic, OpenAI, OpenRouter, Google, Bedrock, or local Ollama — your pick; Pi negotiates |
| **`@earendil-works/pi-coding-agent`**        | `^0.74.0`  | The vendor-neutral substrate `@swt-labs/runtime` wraps. Installed as a peer-dep            |
| **Git**                                      | any recent | Phase commits, milestone tags, the pre-push hook                                           |
| One of: **npm 10+**, **pnpm 9+**, **bun 1+** | —          | Pick whichever you already use                                                             |

Optional but recommended:

- **`jq`** — used by some helper scripts; `brew install jq` on macOS, `apt install jq` on Linux.
- **A terminal with 256-color + Unicode support** — `swt watch` renders an Ink TUI dashboard.

To check Pi is installed and reachable:

```bash
swt doctor
```

Output includes the Pi peer-dep version, Node version, and `.swt-planning/` presence check. If Pi isn't installed yet, `swt doctor` tells you what to install.

---

## Quick start: a real session

This is what a typical first hour with SWT looks like.

### 1. Bootstrap a project (`swt vibe`, no args)

In an empty directory or an existing repo:

```bash
swt vibe
```

Interactively walks you through:

- Naming the project + describing it
- Capturing 3–5 high-level requirements (via the discussion engine)
- Choosing your defaults: `effort` (`thorough` / `balanced` / `fast` / `turbo`), `autonomy` (`cautious` / `standard` / `confident` / `pure-vibe`), `verification_tier` (`quick` / `standard` / `deep`)

Result: a populated `.swt-planning/` directory with `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, and a `config.json` capturing your defaults.

### 2. Map an existing codebase (brownfield, optional)

If you ran `swt vibe` in an existing repo, the bootstrap flow can run a Scout pass over the codebase to populate `.swt-planning/codebase/` with `STACK.md`, `ARCHITECTURE.md`, `PATTERNS.md`, `CONCERNS.md` — a dense, cache-friendly snapshot of what's already there. Subsequent agent calls read this once and reference it for the whole milestone instead of re-grepping.

### 3. Plan and execute the next phase

```bash
swt vibe
```

`vibe` is the orchestrator. It detects what state you're in (no plan? planned but not built? built but not verified? verified but not archived?) and routes you to the right next step. In the common "fresh project" case:

- Spawns **Scout** for ambient research (read-only tools, `off` thinking — the cheap tier)
- Spawns **Architect** for design decisions (read-only tools, `medium` thinking — the quality tier)
- Asks you to confirm scope before any code is written
- Spawns **Lead** to break the phase into atomic tasks (coding tools, persistent session)
- Spawns **Dev** to execute each task with one commit per task (coding tools, ephemeral session per task)
- Runs the **static-check ladder** (typecheck → lint → format → tests) — short-circuits on first failure
- Escalates to **QA** (LLM-tier must-haves verification) if static checks pass
- Routes to **Debugger** (full coding tools + `xhigh` extended thinking — the reasoning tier) when QA's ladder finds something a Dev fix can't resolve
- Asks you to confirm UAT before declaring the phase complete

You can short-circuit to a specific stage with `swt vibe --plan=NN`, `swt vibe --execute=NN`, etc.

### 4. Inspect progress at any time

```bash
swt                      # bare `swt` auto-launches the dashboard (SWT's primary surface)
swt status               # current phase, milestone, % complete
swt detect-phase --json  # machine-readable state (used by the statusline / IDE plugins)
swt doctor               # Node + Pi peer-dep + .swt-planning/ presence
swt watch                # interactive Ink TUI dashboard scoped to the active milestone
swt dashboard            # explicit invocation of the dashboard (same as bare `swt`)
```

### 5. Archive a completed milestone

When all phases in a milestone pass UAT:

```bash
swt vibe --archive
```

Archives `.swt-planning/phases/*` into `.swt-planning/milestones/<NN>-<slug>/`, runs the 7-point pre-archive audit, generates `SHIPPED.md`, and tags the commit if `auto_push` is configured.

---

## The methodology

### Phase lifecycle (TDD2 §11.1 FSM)

Every phase goes through five states:

```
needs_discussion  →  needs_plan_and_execute  →  needs_execute  →  needs_verification  →  archived
     (optional)              ↑                       ↑                  ↓
                             └──── if user           └──── if QA        └──── if UAT issues
                                  rejects scope            fails              found by user
```

`swt vibe` reads `STATE.md` + on-disk artefacts, computes the current state, and routes to the right command. Manual flags (`--plan`, `--execute`, `--verify`, `--archive`) bypass auto-routing when you want to be explicit.

### Static-check ladder (TDD2 §11.2)

QA runs in two tiers:

1. **Static-check ladder** (cheap, deterministic) — typecheck → lint → format → tests. Short-circuits on first failure. If everything passes AND no LLM-tier verification is wired, the phase passes with `result: 'pass'`.
2. **LLM must-haves verification** (the rich tier) — when the ladder passes and an `LlmVerificationEscalator` is wired, the QA agent verifies each P0 must-have from the plan against the codebase. Produces `verification: {must_have_id, verdict, evidence}` array.

The ladder always runs first. Most failures are caught at the cheap tier and never spend an LLM token. The LLM tier only fires when the static surface is clean AND a real must-haves question remains.

### The artefact pipeline

```
.swt-planning/
├── PROJECT.md              ← what we're building (you write this)
├── REQUIREMENTS.md         ← validated + active + out-of-scope (you write this)
├── ROADMAP.md              ← milestones → phases (Architect generates, you approve)
├── STATE.md                ← current phase, milestone, todos (machine-managed)
├── CONTEXT.md              ← milestone-level scope decisions (Scope mode writes this)
├── config.json             ← effort, autonomy, model profiles (you tune)
├── codebase/               ← brownfield map
│   ├── STACK.md
│   ├── ARCHITECTURE.md
│   ├── PATTERNS.md
│   └── CONCERNS.md
├── phases/
│   └── 01-{slug}/
│       ├── {NN}-CONTEXT.md  ← discussion outputs
│       ├── {NN}-RESEARCH.md ← Scout's findings
│       ├── {NN}-{MM}-PLAN.md ← Lead's task breakdown (per plan in the phase)
│       ├── {NN}-{MM}-SUMMARY.md ← Dev's per-plan execution record
│       ├── {NN}-VERIFICATION.md ← QA's contract verification
│       └── {NN}-UAT.md      ← user acceptance scenarios
└── milestones/             ← archived phases, frozen
    └── 01-{slug}/
```

Artefacts are read at the **start** of each agent call as part of the cache-stable prefix. M4 PR-32 inserts the Anthropic `cache_control: ephemeral` marker at the `cacheBreakpointIndex` recorded by `prompt-builder.ts` per ADR-006 — same content, paid once per file, amortised across every turn in the milestone.

### Parallel dispatch (M3 primitives shipping)

Parallel Dev tasks within a phase fan out across per-task git worktrees:

- **`WorktreeManager`** owns the 8-state lifecycle FSM (created → claimed → dispatched → agent_running → agent_complete → harvested → removed; `failed` reachable from any non-terminal state) per TDD2 §9.1.
- **`ClaimRegistry`** rejects parallel tasks that overlap on declared `claims[]` (SHA-1-of-normalized-lowercase-path identifier — case-insensitive-FS safe).
- **`resolveDag`** converts a plan's `depends_on[]` arrays into ordered parallel batches via Kahn's algorithm.
- **PID-liveness lock files** at `.swt-planning/locks/task-<taskId>.lock` give crash recovery a deterministic signal (`process.kill(pid, 0)`).
- **`swt_report_result` Pi Extension** persists the per-task result envelope before each agent exits (ADR-002).

These primitives shipped in Plan 03-01..03-04 plus the session-wiring follow-up; `runMilestone` activates the live parallel dispatch path. `swt cleanup` reaps stale worktrees and lockfiles after crashes.

---

## Configuration

Live config lives in `.swt-planning/config.json` and is editable directly or via `swt config set <key> <value>`. The shipped defaults are in `config/defaults.json` — every key below is reproduced from that file in source order.

### All defaults

| Key                                  | Default       | Effect                                                                                                                                                                                         |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort`                             | `"balanced"`  | Planning depth and verification thoroughness; also a turn-budget scalar (1.5× → 0.6×) applied to every agent. `thorough` / `balanced` / `fast` / `turbo`.                                      |
| `autonomy`                           | `"standard"`  | How aggressively `swt vibe` advances without prompts. `cautious` stops every stage; `pure-vibe` auto-loops everything until a hard error. `cautious` / `standard` / `confident` / `pure-vibe`. |
| `auto_commit`                        | `true`        | Auto-create one atomic commit per completed plan task.                                                                                                                                         |
| `planning_tracking`                  | `"manual"`    | How `.swt-planning/` interacts with git: `manual` (you decide), `ignore` (gitignored), `commit` (auto-commit at planning checkpoints).                                                         |
| `auto_push`                          | `"never"`     | When to push commits to `origin`: `never` / `after_phase` / `always`.                                                                                                                          |
| `verification_tier`                  | `"standard"`  | What QA runs. `quick` = static-check ladder only; `standard` = +must-haves; `deep` = +integration + cross-phase traceability.                                                                  |
| `skill_suggestions`                  | `true`        | Surface relevant skills to agents during planning and execution.                                                                                                                               |
| `auto_install_skills`                | `false`       | Auto-install suggested skills instead of only recommending them.                                                                                                                               |
| `discovery_questions`                | `true`        | Ask project-discovery questions during the `swt vibe` bootstrap flow.                                                                                                                          |
| `discussion_mode`                    | `"questions"` | How the discussion engine gathers phase context — see [Skills and discovery](#skills-and-discovery). `questions` / `assumptions` / `auto`.                                                     |
| `context_compiler`                   | `true`        | Pre-compile per-agent context bundles to cut redundant token spend.                                                                                                                            |
| `visual_format`                      | `"unicode"`   | Status/diagram rendering style: `unicode` box-drawing or `ascii` fallback.                                                                                                                     |
| `max_tasks_per_plan`                 | `5`           | Upper bound on tasks the Architect packs into a single plan.                                                                                                                                   |
| `prefer_teams`                       | `"auto"`      | Use parallel agent teams when the runtime supports them: `auto` / `always` / `never`.                                                                                                          |
| `branch_per_milestone`               | `false`       | Cut a dedicated git branch for each milestone instead of working on the current branch.                                                                                                        |
| `plain_summary`                      | `true`        | Emit a plain-language summary alongside the structured `SUMMARY.md`.                                                                                                                           |
| `active_profile`                     | `"default"`   | The currently-selected entry from `custom_profiles` (or `default`).                                                                                                                            |
| `custom_profiles`                    | `{}`          | Named bundles of config overrides you can switch between with `active_profile`.                                                                                                                |
| `model_profile`                      | `"quality"`   | Coarse cost/quality switch applied across all six agents — see [Model routing and cost](#model-routing-and-cost). `quality` / `balanced` / `cost`.                                             |
| `model_overrides`                    | `{}`          | Per-role model overrides (e.g. force the Architect onto a cheaper model) — see [Model routing and cost](#model-routing-and-cost).                                                              |
| `agent_max_turns`                    | `{...}`       | Per-agent turn caps. Shipped defaults: scout 15, qa 25, architect 30, lead 50, dev 75, debugger 80.                                                                                            |
| `qa_skip_agents`                     | `["docs"]`    | Agent roles whose output skips the QA gate.                                                                                                                                                    |
| `worktree_isolation`                 | `"off"`       | Run each parallel task in an isolated git worktree: `off` / `auto` / `on`.                                                                                                                     |
| `token_budgets`                      | `true`        | Enforce per-agent token budgets and surface overruns.                                                                                                                                          |
| `two_phase_completion`               | `true`        | Require a separate verification pass before a plan is marked complete.                                                                                                                         |
| `metrics`                            | `true`        | Record per-run metrics (tokens, cost, durations) for `swt status`/dashboard.                                                                                                                   |
| `smart_routing`                      | `true`        | Let the orchestrator pick the cheapest viable route through the lifecycle FSM.                                                                                                                 |
| `validation_gates`                   | `true`        | Enforce static-check and must-have gates between lifecycle stages.                                                                                                                             |
| `snapshot_resume`                    | `true`        | Persist resumable snapshots so an interrupted run can pick up where it stopped.                                                                                                                |
| `lease_locks`                        | `true`        | Use lease-based PID-liveness locks for crash-safe parallel dispatch.                                                                                                                           |
| `event_recovery`                     | `true`        | Replay the event log to reconcile state after a crash or compaction.                                                                                                                           |
| `monorepo_routing`                   | `true`        | Detect monorepo package boundaries and scope agents to the right sub-tree.                                                                                                                     |
| `rolling_summary`                    | `false`       | Maintain a rolling cross-phase summary instead of regenerating it each phase.                                                                                                                  |
| `require_phase_discussion`           | `false`       | Force a discussion stage before every phase, even when context already exists.                                                                                                                 |
| `auto_uat`                           | `false`       | When QA passes, auto-route into UAT (`true`) or stop and ask (`false`).                                                                                                                        |
| `max_uat_remediation_rounds`         | `false`       | Cap on automatic UAT remediation rounds; `false` means no cap.                                                                                                                                 |
| `statusline_hide_limits`             | `false`       | Hide rate-limit counters from the status line.                                                                                                                                                 |
| `statusline_hide_limits_for_api_key` | `false`       | Hide rate-limit counters specifically when running on an API key.                                                                                                                              |
| `statusline_hide_agent_in_tmux`      | `false`       | Hide the active-agent indicator from the status line inside tmux.                                                                                                                              |
| `statusline_collapse_agent_in_tmux`  | `false`       | Collapse the active-agent indicator to a compact form inside tmux.                                                                                                                             |
| `debug_logging`                      | `false`       | Emit verbose debug logs from the harness and hooks.                                                                                                                                            |
| `bash_guard`                         | `true`        | Hook-enforced bash-command guard for spawned agents. README-only operator note — set in `config/hooks.json`, not `config/defaults.json`.                                                       |
| `caveman_style`                      | `"none"`      | [Caveman language mode](#caveman-language-mode)                                                                                                                                                |
| `caveman_commit`                     | `false`       | [Caveman language mode](#caveman-language-mode)                                                                                                                                                |
| `caveman_review`                     | `false`       | [Caveman language mode](#caveman-language-mode)                                                                                                                                                |

### Optional extension hooks

Advanced blocks (not usually edited by hand): `telemetry`, `marketplace`, `hooks`. The hook registry lives in `config/hooks.json`; run `swt config show` for the full live config.

### Skills and discovery

`skill_suggestions` and `auto_install_skills` control how SWT surfaces agent skills; `discovery_questions` and `discussion_mode` control how the discussion engine gathers phase context.

| Key               | Type   | Default     | Values                               |
| ----------------- | ------ | ----------- | ------------------------------------ |
| `discussion_mode` | string | `questions` | `questions` / `assumptions` / `auto` |

`questions` asks clarifying questions from scratch. `assumptions` uses existing codebase map data to propose evidence-backed assumptions first, then falls back to questions if no map exists. `auto` picks `assumptions` when `.swt-planning/codebase/META.md` exists and otherwise uses `questions`.

### Model routing and cost

`model_profile` is the coarse cost/quality switch applied across all six agents (`quality` / `balanced` / `cost`). `model_overrides` is a per-role escape hatch — e.g. `{"architect": "cheaper-model"}` forces just the Architect onto a different model for a low-stakes project. `agent_max_turns` caps how many turns each role may take.

### Caveman language mode

`caveman_style`, `caveman_commit`, and `caveman_review` opt into a deliberately terse "caveman" phrasing for agent output. `caveman_style` (`none` / `light` / `full`) sets the overall tone; `caveman_commit` applies it to commit messages; `caveman_review` applies it to review comments. All three default to off.

---

## Command reference

Bare `swt` (no verb, no flags) auto-launches the dashboard — SWT's primary surface and the one-stop place to manage a project (phases, agent activity, tokens, costs, UAT). `swt vibe` is the in-terminal orchestrator for power users + scripts; the explicit verbs below are escape hatches for the same audience.

### Working today (`main` HEAD)

| Command            | Use case                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swt vibe`         | The methodology entrypoint. Auto-detects project state and routes to discuss / plan / execute / verify / archive. Accepts `--plan N`, `--execute N`, `--discuss N`, `--assumptions N`, `--scope`, `--verify [N]`, `--archive`, `--add "name"`, `--insert N "name"`, `--remove N`, plus modifiers `--effort {thorough\|balanced\|fast\|turbo}`, `--skip-qa`, `--skip-audit`, `--yolo`. |
| `swt init`         | Scaffold `.swt-planning/` in the current directory without running the full discussion engine. Useful when you want to seed `PROJECT.md` / `REQUIREMENTS.md` by hand.                                                                                                                                                                                                                 |
| `swt status`       | Show current phase, milestone, plan velocity, todos, blockers, codebase profile.                                                                                                                                                                                                                                                                                                      |
| `swt doctor`       | Verify SWT prerequisites: Node ≥ 20.18, Pi peer-dep, `.swt-planning/` presence. Use this first when something feels off. Surfaces `report.pi` populated from `SpawnerEnvironment.probe()`.                                                                                                                                                                                            |
| `swt detect-phase` | Print the computed phase-detection state (`--bash-format` for shell consumption, JSON by default). Helper used by `swt vibe` routing.                                                                                                                                                                                                                                                 |
| `swt config`       | Read or update SWT configuration: `swt config show \| get <key> \| set <key> <value>`.                                                                                                                                                                                                                                                                                                |
| `swt update`       | Check npm registry for a newer published SWT version. `--json` for scripting; `--strict` fails offline; `--registry=<url>`, `--no-cache`.                                                                                                                                                                                                                                             |
| `swt watch`        | Open the Ink TUI dashboard scoped to the active milestone. Real-time view of phases, agents, costs.                                                                                                                                                                                                                                                                                   |
| `swt dashboard`    | Boot the localhost web dashboard daemon and open it in the default browser. Companion observability surface for an in-flight `swt vibe` run. Hono + Solid + SSE + chokidar v4. `--port N`, `--host H`, `--unsafe-public`, `--no-open`, `--debug`.                                                                                                                                     |
| `swt cleanup`      | Reap stale per-task git worktrees and PID-liveness lock files left behind by crashed agents. Safe to run any time; idempotent.                                                                                                                                                                                                                                                        |
| `swt rpc`          | Delegate to Pi's JSON-RPC mode (stdout reserved for the protocol stream). Per TDD2 §3.2 + §5.                                                                                                                                                                                                                                                                                         |
| `swt bench`        | Replay the TPAC reference scenario and emit a validated `TpacReport` JSON. Per TDD2 §3.2 + §14.9. Live activation gated on user-driven cassette recording.                                                                                                                                                                                                                            |
| `swt help`         | Print usage, list all registered commands. Also `swt --help` and `swt {verb} --help`.                                                                                                                                                                                                                                                                                                 |
| `swt version`      | Print SWT version. Also `swt --version`.                                                                                                                                                                                                                                                                                                                                              |

### Use case quick-pick

- **Fresh project** → `swt vibe` (routes to bootstrap)
- **Existing project, daily work** → bare `swt` (auto-launches the dashboard, the primary surface) or `swt vibe` (terminal orchestrator), `swt status` (peek), `swt watch` (Ink TUI)
- **After a crash** → `swt cleanup` to reap stale worktrees + locks, then `swt vibe` to resume
- **Something feels broken** → `swt doctor` first
- **Configuration tweaks** → `swt config show` / `swt config set <key> <value>`
- **Discoverability** → `swt help` lists every registered command

### Help and flags

Every command supports `--help`:

```bash
swt vibe --help
swt dashboard --help
swt config --help
```

Top-level flags: `--version` (print version), `--help` (top-level usage).

---

## Contributing, security, license

- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security disclosures: [SECURITY.md](SECURITY.md).
- License: MIT, see [LICENSE](LICENSE).

Active development happens on `main`. Prereleases publish to npm under dist-tag `next` via OIDC trusted publishing; the stable cut promotes to `latest`.
