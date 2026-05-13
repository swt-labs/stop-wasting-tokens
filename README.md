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
npm install -g stop-wasting-tokens@next       # v3 prerelease (recommended)
# or: pnpm add -g stop-wasting-tokens@next
# or: bun  add -g stop-wasting-tokens@next
```

```bash
swt --version        # 3.0.0-alpha.1
swt doctor           # checks Node ≥ 20.18, Pi peer-dep, .swt-planning/ presence
swt vibe             # start here
```

Plain `stop-wasting-tokens` (no `@next`) still resolves to legacy v2.3.5 until v3 cuts to `latest`. Detailed install paths, source builds, and v2 migration: [Install](#install).

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

> v3 prereleases are on npm under dist-tag `next`. Plain `npm install -g stop-wasting-tokens` still resolves to legacy v2.3.5 (`latest`) until the v3 stable cut.

### Global install (recommended)

```bash
npm install -g stop-wasting-tokens@next
# or: pnpm add -g stop-wasting-tokens@next
# or: bun  add -g stop-wasting-tokens@next

swt --version        # 3.0.0-alpha.1
swt doctor
```

### Install from source (`main` HEAD)

```bash
git clone https://github.com/swt-labs/stop-wasting-tokens.git
cd stop-wasting-tokens
pnpm install
pnpm typecheck && pnpm test     # ~1150 passing at HEAD
pnpm build                       # produces dist/cli.mjs
node dist/cli.mjs --version
```

Then alias the built CLI so `swt` works from anywhere:

```bash
alias swt="node $(pwd)/dist/cli.mjs"
swt --version
swt doctor                       # verifies Node, Pi peer-dep, .swt-planning/ presence
```

Real Pi-backed `swt vibe` sessions need a configured Anthropic / OpenAI / OpenRouter API key. The cassette infrastructure (M1 PR-06) lets the test suite replay recorded sessions deterministically without burning tokens.

### Legacy v2.x

The v2.3.5 tarball remains on npm for projects that haven't migrated. **v2.x is unsupported post-v3.0** — pin to a specific patch if you cannot migrate immediately. The supported migration path is `swt migrate --to=v3`.

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

Active development on [`main`](https://github.com/swt-labs/stop-wasting-tokens/tree/main). **v3.0.0-alpha.1 is STRUCTURALLY COMPLETE** as of 2026-05-12 — all 6 milestones have shipped on `main`. Release cut to npm awaits user-driven public benchmark recording (PR-50).

### Milestone progress

| Milestone              | Status                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Foundation          | **CLOSED** 2026-05-12 — 12 PRs across 3 plans / 15 atomic commits. Pi adoption, runtime/orchestration/shared scaffolding, cassette infrastructure, token meter, provider quirks, 13 ADRs, reproducible-build CI.                                                                                                                                                                                               |
| M2 Single-agent path   | **CLOSED** 2026-05-12 — 10 PRs. Methodology dispatches through orchestration; 6 SDLC roles; QA ladder; dashboard SSE; cassette regression; TPAC aggregator; `swt rpc` + `swt bench` verbs. Live TPAC baseline pending user cassette recording.                                                                                                                                                                 |
| M3 Worktree dispatcher | **CLOSED** 2026-05-12 — 4 plans, 9 PRs (Plan 03-01..03-04 + session-wiring + runMilestone follow-ups). `WorktreeManager` FSM, `ClaimRegistry`, `resolveDag`, PID-liveness locks, `swt_report_result` wire-up, real Pi `createSession`, `runVibe` programmatic entry, dashboard Worktrees panel, `swt cleanup` verb, chaos suite, Windows path discipline + ADR-009 Accepted.                                   |
| M4 Token meter + cache | **STRUCTURALLY COMPLETE** 2026-05-12 — 7 of 8 PRs (PR-31..35 + 37 + 38; PR-36 hard-deferred on M2 baseline). Deterministic `buildPrompt`, Anthropic `cache_control` wiring, cache-hit measurement + dashboard CacheHitPanel, OpenAI auto-cache observation, Budget Gate live + BudgetPanel, dashboard TPAC panel, ADR-006 + ADR-007 Accepted. 2 of 3 M4 EXIT GATE criteria PASS; TPAC −40% awaits M2 baseline. |
| M5 Multi-provider      | **STRUCTURALLY COMPLETE** 2026-05-12 — 6 PRs (PR-39..PR-44). OpenRouter shim validation, Gemini ToS warnings, four router strategies (pinned/round-robin/tier-routed/cost-optimized), fallback chain + retry budget, per-provider cost panel, failover simulation, ADR-011 Accepted. 1 of 3 M5 EXIT GATE criteria PASS (failover sim); 2 DEFERRED on user-driven cassette recording.                           |
| M6 Decommission + ship | **STRUCTURALLY COMPLETE** 2026-05-12 — Plan 06-01 closed (PR-45..PR-53). Release operations (public benchmark, npm publish, homepage update) are user-driven. ADR-012 (six-month LTS) was promoted Accepted at PR-53 and retracted same-day; v2.3.x is unsupported post-v3.0.                                                                                                                                  |

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
swt                      # bare `swt` opens the web dashboard daemon (SWT_NO_DASHBOARD=1 to opt out)
swt status               # current phase, milestone, % complete
swt detect-phase --json  # machine-readable state (used by the statusline / IDE plugins)
swt doctor               # Node + Pi peer-dep + .swt-planning/ presence
swt watch                # interactive Ink TUI dashboard scoped to the active milestone
swt dashboard            # localhost web dashboard daemon (explicit form)
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

Live config lives in `.swt-planning/config.json` and is editable directly or via `swt config set <key> <value>`.

The knobs that matter most:

| Key                      | Values                                              | Default    | Effect                                                                                                                                   |
| ------------------------ | --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `effort`                 | `thorough` / `balanced` / `fast` / `turbo`          | `balanced` | Planning depth and verification thoroughness; also a turn-budget scalar (1.5× → 0.6×) applied to every agent                             |
| `autonomy`               | `cautious` / `standard` / `confident` / `pure-vibe` | `standard` | How aggressively `swt vibe` advances without prompts. `cautious` stops every stage; `pure-vibe` auto-loops everything until a hard error |
| `verification_tier`      | `quick` / `standard` / `deep`                       | `standard` | What QA runs. `quick` = static-check ladder only; `standard` = +must-haves; `deep` = +integration + cross-phase traceability             |
| `model_profile`          | `quality` / `balanced` / `cost`                     | `quality`  | Coarse cost/quality switch applied across all six agents                                                                                 |
| `prefer_teams`           | `auto` / `always` / `never`                         | `auto`     | Use parallel agent teams (when supported by your runtime).                                                                               |
| `auto_uat`               | `true` / `false`                                    | `false`    | When QA passes, auto-route into UAT (`true`) or stop and ask (`false`)                                                                   |
| `auto_push`              | `never` / `after_phase` / `always`                  | `never`    | When to push commits to `origin`                                                                                                         |
| `planning_tracking`      | `manual` / `ignore` / `commit`                      | `manual`   | How `.swt-planning/` interacts with git: `manual` (you decide), `ignore` (gitignored), `commit` (auto-commit at planning checkpoints)    |
| `agent_max_turns.{role}` | int                                                 | varies     | Per-agent turn cap. Defaults: scout 15, qa 25, architect 30, lead 50, dev 75, debugger 80                                                |
| `model_overrides.{role}` | string                                              | none       | Override the model for a specific agent (e.g. force the Architect onto a cheaper model for a low-stakes project)                         |

Advanced blocks (not usually edited by hand): `telemetry`, `marketplace`, `hooks`. Run `swt config show` for the full live config.

---

## Command reference

`swt vibe` is the orchestrator that calls every other surface internally; the explicit verbs below are escape hatches for power users + IDE integrations. Bare `swt` (no verb, no flags) opens the web dashboard daemon — set `SWT_NO_DASHBOARD=1` to restore the legacy "print help" behavior.

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
| `swt dashboard`    | Boot the localhost web dashboard daemon and open it in the default browser. Hono + Solid + SSE + chokidar v4. `--port N`, `--host H`, `--unsafe-public`, `--no-open`, `--debug`. Bare `swt` (no verb) is an alias for this.                                                                                                                                                           |
| `swt cleanup`      | Reap stale per-task git worktrees and PID-liveness lock files left behind by crashed agents. Safe to run any time; idempotent.                                                                                                                                                                                                                                                        |
| `swt migrate`      | Migrate a v2.x project to v3. Use `--to=v3` (currently the only supported target). Reads the legacy `.planning/` layout and rewrites it to `.swt-planning/` schemas.                                                                                                                                                                                                                  |
| `swt rpc`          | Delegate to Pi's JSON-RPC mode (stdout reserved for the protocol stream). Per TDD2 §3.2 + §5.                                                                                                                                                                                                                                                                                         |
| `swt bench`        | Replay the TPAC reference scenario and emit a validated `TpacReport` JSON. Per TDD2 §3.2 + §14.9. Live activation gated on user-driven cassette recording.                                                                                                                                                                                                                            |
| `swt help`         | Print usage, list all registered commands. Also `swt --help` and `swt {verb} --help`.                                                                                                                                                                                                                                                                                                 |
| `swt version`      | Print SWT version. Also `swt --version`.                                                                                                                                                                                                                                                                                                                                              |

### Use case quick-pick

- **Fresh project** → `swt vibe` (routes to bootstrap)
- **Existing project, daily work** → `swt vibe` (auto-routes), `swt status` (peek), `swt watch` or `swt dashboard` (ambient view), bare `swt` opens the dashboard
- **Coming from v2.x** → `swt migrate --to=v3`
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

Active development happens on `main`. The legacy v2.3.x line is unsupported post-v3.0; pin to a specific v2.3.x tarball on npm if you cannot migrate immediately, and run `swt migrate --to=v3` when ready.
