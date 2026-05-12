# stop-wasting-tokens

[![npm](https://img.shields.io/npm/v/stop-wasting-tokens.svg)](https://www.npmjs.com/package/stop-wasting-tokens)
[![CI](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml/badge.svg)](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> A spec-driven, Pi-native coding harness built around a single obsession: **stop wasting tokens**.

`swt` is a Node/TypeScript CLI you install once. It wraps every coding-agent session in a six-agent software development lifecycle, persistent planning artefacts, and goal-backward verification — so the model never re-discovers what you already specified, never improvises past a documented plan, and never burns turns on work the spec doesn't ask for.

If you've ever watched a model re-read your codebase three times in one session, hallucinate an architecture you already rejected, or chase a fix in circles because the goal drifted mid-stream — that's the waste this tool is engineered to eliminate.

---

## Table of contents

- [What "saving tokens" actually means](#what-saving-tokens-actually-means)
- [How SWT works](#how-swt-works)
- [Project status](#project-status)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Quick start: a real session](#quick-start-a-real-session)
- [The methodology](#the-methodology)
- [Configuration](#configuration)
- [Command reference](#command-reference)
- [Design + decisions](#design--decisions)
- [Troubleshooting](#troubleshooting)
- [Contributing, security, license](#contributing-security-license)

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

Active development on [`main`](https://github.com/swt-labs/stop-wasting-tokens/tree/main). The current release line is **v3.0.0-alpha.1** and ships from source until the M6 release gate; the npm-published binary catches up at the release cut.

### Milestone progress

| Milestone              | Status                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Foundation          | **CLOSED** 2026-05-12 — 12 PRs across 3 plans / 15 atomic commits. Pi adoption, runtime/orchestration/shared scaffolding, cassette infrastructure, token meter, provider quirks, 13 ADRs, reproducible-build CI, 33-test debt remediation.                                                                                                                                                        |
| M2 Single-agent path   | **CLOSED** 2026-05-12 — 10 PRs across 2 plans. Methodology dispatches through orchestration; 6 SDLC role profiles; QA static-check ladder; dashboard SSE; cassette regression scaffolding; TPAC aggregator + frozen Zod schema; `swt rpc` + `swt bench` verbs. Live TPAC baseline + 4 deferred runtime consumers pending the session-wiring follow-up + a user-driven cassette recording session. |
| M3 Worktree dispatcher | **Plan 03-01 closed** 2026-05-12 — 5 PRs / 5 atomic commits. `WorktreeManager` 8-state lifecycle FSM, `ClaimRegistry`, `resolveDag` (Kahn's algorithm), PID-liveness lock-files, `swt_report_result` Extension wire-up contract. ADR-008 promoted to Accepted. Plan 03-02 (dashboard panel + chaos suite + `swt cleanup` + Windows path discipline) next.                                         |
| M4 Token meter + cache | Pending                                                                                                                                                                                                                                                                                                                                                                                           |
| M5 Multi-provider      | Pending                                                                                                                                                                                                                                                                                                                                                                                           |
| M6 Decommission + ship | Pending — v3.0.0 release cut + npm publish at this gate                                                                                                                                                                                                                                                                                                                                           |

### Test posture at HEAD

- **994 tests pass / 46 skipped / 0 fail** across the workspace.
- `pnpm typecheck` clean (`tsc --build`).
- `pnpm lint` 0 errors (~244 pre-existing `import/no-restricted-paths` warnings — pnpm-workspace resolver carry-forward).
- `pnpm format:check` clean.

Per-version changes tracked in [CHANGELOG.md](./CHANGELOG.md). Detailed per-milestone commit trails live in [`.vbw-planning/v3-tracking.md`](./.vbw-planning/v3-tracking.md). Authoritative design: [`TDD2.md`](./TDD2.md).

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

## Install

> SWT v3 ships from source today. The published npm package (`stop-wasting-tokens`) catches up to `main` at the M6 release gate.

### Source install from `main`

```bash
git clone https://github.com/swt-labs/stop-wasting-tokens.git
cd stop-wasting-tokens
pnpm install
pnpm typecheck && pnpm test     # 994 passing at HEAD
pnpm build                       # produces packages/cli/dist/cli.mjs
node packages/cli/dist/cli.mjs --version
```

Real Pi-backed `swt vibe` sessions require a configured Anthropic / OpenAI / OpenRouter API key. The cassette infrastructure (M1 PR-06) lets the test suite replay recorded sessions deterministically without burning tokens.

To run the binary from anywhere, alias the built CLI:

```bash
alias swt="node $(pwd)/packages/cli/dist/cli.mjs"
swt --version
```

The legacy `v2.3.5` binary is still on npm for projects that haven't migrated yet. v2 patches land on [`v2-archive`](https://github.com/swt-labs/stop-wasting-tokens/tree/v2-archive) under the [ADR-012](./docs/decisions/ADR-012-six-month-lts-policy.md) six-month LTS window.

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
swt status               # current phase, milestone, % complete
swt detect-phase --json  # machine-readable state (used by the statusline / IDE plugins)
swt doctor               # Node + Pi peer-dep + .swt-planning/ presence
swt watch                # interactive TUI dashboard scoped to the active milestone
swt dashboard            # localhost web dashboard daemon
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

When M3 wires the deferred session-wiring follow-up + Plan 03-02 lands, parallel Dev tasks within a phase will fan out across per-task git worktrees:

- **`WorktreeManager`** owns the 8-state lifecycle FSM (created → claimed → dispatched → agent_running → agent_complete → harvested → removed; `failed` reachable from any non-terminal state) per TDD2 §9.1.
- **`ClaimRegistry`** rejects parallel tasks that overlap on declared `claims[]` (SHA-1-of-normalized-lowercase-path identifier — case-insensitive-FS safe).
- **`resolveDag`** converts a plan's `depends_on[]` arrays into ordered parallel batches via Kahn's algorithm.
- **PID-liveness lock files** at `.swt-planning/locks/task-<taskId>.lock` give crash recovery a deterministic signal (`process.kill(pid, 0)`).
- **`swt_report_result` Pi Extension** persists the per-task result envelope before each agent exits (ADR-002).

These primitives ship today as Plan 03-01. The live parallel dispatch path activates once the runtime layer wires real `session.prompt()` — single-file follow-up tracked separately.

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

`swt vibe` is the orchestrator that calls every other surface internally; the explicit verbs below are escape hatches for power users + IDE integrations.

### Working today (`main` HEAD)

| Command            | Use case                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swt vibe`         | The methodology entrypoint. Auto-detects project state and routes to discuss / plan / execute / verify / archive. Accepts `--plan N`, `--execute N`, `--discuss N`, `--assumptions N`, `--scope`, `--verify [N]`, `--archive`, `--add "name"`, `--insert N "name"`, `--remove N`, plus modifiers `--effort {thorough\|balanced\|fast\|turbo}`, `--skip-qa`, `--skip-audit`, `--yolo`. |
| `swt status`       | Show current phase, milestone, plan velocity, todos, blockers, codebase profile.                                                                                                                                                                                                                                                                                                      |
| `swt doctor`       | Verify SWT prerequisites: Node ≥ 20.18, Pi peer-dep, `.swt-planning/` presence. Use this first when something feels off. Surfaces `report.pi` populated from `SpawnerEnvironment.probe()`.                                                                                                                                                                                            |
| `swt detect-phase` | Print the computed phase-detection state (`--bash-format` for shell consumption, JSON by default). Helper used by `swt vibe` routing.                                                                                                                                                                                                                                                 |
| `swt config`       | Read or update SWT configuration: `swt config show \| get <key> \| set <key> <value>`.                                                                                                                                                                                                                                                                                                |
| `swt update`       | Check npm registry for a newer published SWT version. `--json` for scripting; `--strict` fails offline; `--registry=<url>`, `--no-cache`.                                                                                                                                                                                                                                             |
| `swt watch`        | Open the Ink TUI dashboard scoped to the active milestone. Real-time view of phases, agents, costs.                                                                                                                                                                                                                                                                                   |
| `swt dashboard`    | Boot the localhost web dashboard daemon and open it in the default browser. Hono + Solid + SSE + chokidar v4. `--port N`, `--host H`, `--unsafe-public`, `--no-open`, `--debug`.                                                                                                                                                                                                      |
| `swt rpc`          | Delegate to Pi's JSON-RPC mode (stdout reserved for the protocol stream). Per TDD2 §3.2 + §5. **Structurally complete; live activation gated on the session-wiring follow-up.**                                                                                                                                                                                                       |
| `swt bench`        | Replay the TPAC reference scenario and emit a validated `TpacReport` JSON. Per TDD2 §3.2 + §14.9. **Structurally complete; live activation gated on cassette recording + session-wiring follow-up.**                                                                                                                                                                                  |
| `swt help`         | Print usage, list all registered commands. Also `swt --help` and `swt {verb} --help`.                                                                                                                                                                                                                                                                                                 |
| `swt version`      | Print SWT version. Also `swt --version`.                                                                                                                                                                                                                                                                                                                                              |

### Use case quick-pick

- **Fresh project** → `swt vibe` (routes to bootstrap)
- **Existing project, daily work** → `swt vibe` (auto-routes), `swt status` (peek), `swt watch` or `swt dashboard` (ambient view)
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

## Design + decisions

The authoritative design document is [`TDD2.md`](./TDD2.md) at the repo root. Read [`docs/design/README.md`](./docs/design/README.md) for the suggested reading order.

13 Architecture Decision Records anchor the design, indexed at [`docs/decisions/README.md`](./docs/decisions/README.md):

- **Accepted (7)**: ADR-001 (Pi adoption), ADR-002 (Extension result protocol), ADR-003 (provider quirks JSON), ADR-004 (cache_control at provider-shim), ADR-005 (delete drivers wholesale), ADR-008 (worktree-per-task — accepted M3 PR-22), ADR-010 (reproducible builds).
- **Proposed (5)**: ADR-006 (cache breakpoint placement), ADR-007 (Budget Gate semantics), ADR-009 (Windows worktree paths), ADR-011 (cassette-only provider matrix), ADR-012 (six-month LTS).
- **Deferred (1)**: ADR-013 (no hosted docs site at v3.0).

Live planning state lives in [`.vbw-planning/`](./.vbw-planning/) — `ROADMAP.md` is the entry point. Per-milestone PR ledger: [`.vbw-planning/v3-tracking.md`](./.vbw-planning/v3-tracking.md).

---

## Troubleshooting

**`swt: command not found` after install**
The source-install pattern aliases `node packages/cli/dist/cli.mjs` to `swt`; ensure your alias is in the right shell rc. Once the M6 release publishes to npm, the global bin convention takes over.

**`swt --version` reports `0.0.0` after a manual rebuild**
You're running a locally-built bundle from before the `CURRENT_VERSION` constant was wired up. Rebuild with `pnpm build` after pulling latest.

**`swt vibe` keeps asking the same confirmation**
Your `autonomy` is set to `cautious` or `standard` (the default). Switch with `swt config set autonomy confident` to auto-chain phases, or `pure-vibe` to auto-loop until a hard error.

**Phase detection is in a weird state**
Run `swt detect-phase` for a JSON dump of what SWT thinks the state is. The `phase_detect_error=true` line points at root cause.

**`swt doctor` reports `Pi runtime not available`**
Pi is declared as a peer-dep (`^0.74.0`); ensure `@earendil-works/pi-coding-agent` is installed in your project or globally. Source installs from `main` include it via `pnpm install`.

**`swt rpc` / `swt bench` exits with `EXIT.NOT_IMPLEMENTED` (2)**
Expected today. Both verbs are structurally complete (CLI surface + flag parsing + delegation chain) but the live runtime activation is gated on a single-file `session.prompt()` follow-up PR. The stderr message points at the activation gate.

---

## Contributing, security, license

- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security disclosures: [SECURITY.md](SECURITY.md).
- License: MIT, see [LICENSE](LICENSE).

Active development happens on `main`. Stable patches for the legacy v2.3.x line land on [`v2-archive`](https://github.com/swt-labs/stop-wasting-tokens/tree/v2-archive) under the [ADR-012](./docs/decisions/ADR-012-six-month-lts-policy.md) six-month LTS window.
