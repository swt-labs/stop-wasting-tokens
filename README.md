# stop-wasting-tokens

[![npm](https://img.shields.io/npm/v/stop-wasting-tokens.svg)](https://www.npmjs.com/package/stop-wasting-tokens)
[![CI](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml/badge.svg)](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> A spec-driven, Pi-native coding harness built around a single obsession: **stop wasting tokens**.

> **v3 redesign in active development on `main`.** v3 is a runtime-layer rewrite onto the vendor-neutral [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) substrate — methodology preserved verbatim from v2, the Codex/Claude-Code/Ollama backends retired in favor of Pi's provider matrix. **M1 Foundation closed 2026-05-12.** **M2 single-agent path is in flight: 6 of 10 PRs landed** (PR-12 → PR-17). The published binary on npm is still v2.3.5; v3.0 cuts from `main` at the M6 release gate. v2.3.x stays on LTS via [`v2-archive`](https://github.com/swt-labs/stop-wasting-tokens/tree/v2-archive) per [ADR-012](./docs/decisions/ADR-012-six-month-lts-policy.md).

`swt` is a Node/TypeScript CLI you install once. It wraps every coding-agent session in a six-agent software development lifecycle, persistent planning artefacts, and goal-backward verification — so the model never re-discovers what you already specified, never improvises past a documented plan, and never burns turns on work the spec doesn't ask for.

If you've ever watched a model re-read your codebase three times in one session, hallucinate an architecture you already rejected, or chase a fix in circles because the goal drifted mid-stream — that's the waste this tool is engineered to eliminate.

---

## Table of contents

- [What "saving tokens" actually means](#what-saving-tokens-actually-means)
- [How SWT works (v3 architecture)](#how-swt-works-v3-architecture)
- [Project status](#project-status)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Quick start: a real session](#quick-start-a-real-session)
- [The methodology](#the-methodology)
- [Configuration](#configuration)
- [Command reference](#command-reference)
- [Migrating from v2.x](#migrating-from-v2x)
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

## How SWT works (v3 architecture)

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

v3 enforces a strict dependency direction — methodology never imports vendor SDKs:

```
shared (leaf)
   ↑
core + runtime           ← runtime is the ONLY layer importing @earendil-works/* (Principle 1)
   ↑
orchestration            ← dispatcher + role-router + prompt-builder
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

Currently **v3.0.0-alpha.1 (in development)** on the [`main`](https://github.com/swt-labs/stop-wasting-tokens/tree/main) branch. The published binary on npm is still v2.3.5.

### M1 Foundation — CLOSED 2026-05-12

| Plan  | PRs          | Headline                                                                                                                         |
| ----- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 01-01 | PR-01..PR-04 | Driver-edge audit + `@swt-labs/runtime` / `@swt-labs/orchestration` / `@swt-labs/shared` scaffolding                             |
| 01-02 | PR-05..PR-09 | Driver packages deleted + cassette infrastructure + token meter + provider quirks + `swt_report_result` Pi Extension             |
| 01-03 | PR-10..PR-11 | 13 ADRs (5 Accepted + 7 Proposed + 1 Deferred) + v2→v3 migration guide + reproducible-build CI + 33 v2.3.5 test-debt remediation |

### M2 Single-agent path — 6 of 10 PRs landed

| Plan  | PRs           | Status                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02-01 | PR-12 → PR-16 | **Complete** — methodology dispatches through `@swt-labs/orchestration`; 6 SDLC role profiles; Dev sequential dispatch with halt-on-failed; QA static-check ladder + LLM escalation contract; UiPermissionGate sibling. HIGH-priority bash-guard security regression FIXED. 12 of 22 in-scope umbrella #32 test debts cleared (methodology 9/9 + verification 3/3). |
| 02-02 | PR-17 → PR-21 | **In progress** — PR-17 shipped (dashboard SSE rewire + chokidar v4 fix + LogPanel TS2322 + 9 dashboard test debts). PR-18..PR-21 pending (cassette regression, TPAC baseline, `swt rpc`, `swt bench`).                                                                                                                                                             |

### Test posture at HEAD

- **858 tests pass / 45 skipped / 0 fail** across the workspace.
- `pnpm typecheck` clean (`tsc --build`).
- `pnpm lint` 0 errors, 221 warnings (mostly demoted `import/no-restricted-paths` pending M3's eslint-import-resolver-typescript wiring).
- `pnpm format:check` clean.

Per-version changes tracked in [CHANGELOG.md](./CHANGELOG.md). Detailed M1 + M2 commit trails live in [`.vbw-planning/v3-tracking.md`](./.vbw-planning/v3-tracking.md).

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

> **v3 is alpha; not yet on npm.** The instructions below are for v2.3.5 (the currently-published stable binary). For v3 testers, clone the repo — `main` IS the v3 development branch.

### v2.3.5 (stable, on npm)

Install once, globally:

```bash
# npm
npm install -g stop-wasting-tokens

# pnpm
pnpm add -g stop-wasting-tokens

# bun
bun add -g stop-wasting-tokens
```

To pin a specific version (e.g. for CI or reproducible installs):

```bash
npm install -g stop-wasting-tokens@2.3.5
```

To upgrade an existing install to the latest published version:

```bash
npm install -g stop-wasting-tokens@latest
# or
swt update              # built-in self-check; prints the upgrade command
```

The v2.3.5 package ships an ESM-only bundle with a single `swt` binary. No build step, no peer-dependency negotiation, no native modules.

### v3.0.0-alpha (source install from `main`)

For early testers willing to track active development:

```bash
git clone https://github.com/swt-labs/stop-wasting-tokens.git
cd stop-wasting-tokens
pnpm install
pnpm typecheck && pnpm test     # 858 passing at HEAD
pnpm build                       # produces packages/cli/dist/cli.mjs
node packages/cli/dist/cli.mjs --version
```

Real Pi-backed `swt vibe` sessions require a configured Anthropic / OpenAI / OpenRouter API key. The cassette infrastructure (Plan 01-02 PR-06) lets the test suite replay recorded sessions deterministically without burning tokens.

---

## Quick start: a real session

This is what a typical first hour with SWT looks like (target API: v3, with v2 noted where it differs).

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

QA at v3 runs in two tiers:

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

> **v2 → v3 config note**: v2's `backend:` field (codex / claude-code / ollama) is gone. v3's runtime negotiates providers via Pi, so the field has no v3 equivalent. The v3 migration script (`swt migrate --to=v3`, M6 PR-49) strips it from existing configs and adds `roles[*].tier` + the `schema_version: 1` marker.

---

## Command reference

SWT exposes a CLI surface derived from the VBW (`vibe-better-with-claude-code`) methodology. The `main` HEAD ships these verbs as production-ready; `swt vibe` is the orchestrator that calls every other surface internally.

### Working today (`main` HEAD)

| Command            | Use case                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swt vibe`         | The methodology entrypoint. Auto-detects project state and routes to discuss / plan / execute / verify / archive. Accepts `--plan N`, `--execute N`, `--discuss N`, `--assumptions N`, `--scope`, `--verify [N]`, `--archive`, `--add "name"`, `--insert N "name"`, `--remove N`, plus modifiers `--effort {thorough\|balanced\|fast\|turbo}`, `--skip-qa`, `--skip-audit`, `--yolo`. |
| `swt status`       | Show current phase, milestone, plan velocity, todos, blockers, codebase profile.                                                                                                                                                                                                                                                                                                      |
| `swt doctor`       | Verify SWT prerequisites: Node ≥ 20.18, Pi peer-dep, `.swt-planning/` presence. Use this first when something feels off. v3 surfaces `report.pi` populated from `SpawnerEnvironment.probe()` (PR-15).                                                                                                                                                                                 |
| `swt detect-phase` | Print the computed phase-detection state (`--bash-format` for shell consumption, JSON by default). Helper used by `swt vibe` routing.                                                                                                                                                                                                                                                 |
| `swt config`       | Read or update SWT configuration: `swt config show \| get <key> \| set <key> <value>`.                                                                                                                                                                                                                                                                                                |
| `swt update`       | Check npm registry for a newer published SWT version. `--json` for scripting; `--strict` fails offline; `--registry=<url>`, `--no-cache`.                                                                                                                                                                                                                                             |
| `swt watch`        | Open the Ink TUI dashboard scoped to the active milestone. Real-time view of phases, agents, costs.                                                                                                                                                                                                                                                                                   |
| `swt dashboard`    | Boot the localhost web dashboard daemon and open it in the default browser. Hono + Solid + SSE + chokidar v4. `--port N`, `--host H`, `--unsafe-public`, `--no-open`, `--debug`.                                                                                                                                                                                                      |
| `swt help`         | Print usage, list all registered commands. Also `swt --help` and `swt {verb} --help`.                                                                                                                                                                                                                                                                                                 |
| `swt version`      | Print SWT version. Also `swt --version`.                                                                                                                                                                                                                                                                                                                                              |

### Landing in M2 (Plan 02-02 PR-20/21)

| Command     | Use case                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `swt rpc`   | Delegate to Pi's `runRpcMode` for stateless one-shot RPC calls (no methodology surface). Per TDD2 §3.2 + §5.                                |
| `swt bench` | Run the TPAC token-per-acceptance-criterion benchmark across a recorded cassette. Used to track the M4 −40% target against the M2 baseline. |

### Stubs (placeholder commands)

A small number of v2-era verbs (`swt init`, `swt plan`, `swt execute`, `swt verify`, `swt fix`, `swt debug`, `swt research`, `swt map`, etc.) are registered as placeholders that point at the `swt vibe` flag equivalents. They print a roadmap pointer and exit 78 (`EXIT.NOT_IMPLEMENTED`). Most are reachable today as `swt vibe` subroutes.

### Use case quick-pick

- **Fresh project** → `swt vibe` (routes to bootstrap)
- **Existing project, daily work** → `swt vibe` (auto-routes), `swt status` (peek), `swt watch` or `swt dashboard` (ambient view)
- **Something feels broken** → `swt doctor` first
- **Configuration tweaks** → `swt config show` / `swt config set <key> <value>`
- **Discoverability** → `swt help` lists every registered command; stubs print their roadmap phase when invoked

### Help and flags

Every command supports `--help`:

```bash
swt vibe --help
swt dashboard --help
swt config --help
```

Top-level flags: `--version` (print version), `--help` (top-level usage). Commands without an explicit handler fall through to the stub message with the roadmap pointer.

---

## Migrating from v2.x

If you're upgrading from a v2.3.x project to v3.0, the canonical guide is [`docs/operations/migrating-from-v2.md`](./docs/operations/migrating-from-v2.md).

TL;DR (when v3 ships): `npm install -g stop-wasting-tokens@3` + `swt migrate --to=v3`. The migration script (M6 PR-49) rewrites `.swt-planning/config.json` to drop the `backend:` field, adds `roles[*].tier` + `router_strategy:`, and adds the top-level `schema_version: 1` marker.

**LTS posture**: v2.3.x receives 6 months of security + critical-bug patches per [ADR-012](./docs/decisions/ADR-012-six-month-lts-policy.md); plan your migration before that window closes.

**Key v2 → v3 changes** (none are breaking for the methodology layer):

- Runtime substrate: Codex CLI subprocess → `@earendil-works/pi-coding-agent` peer-dep.
- Provider choice: `backend: codex|claude-code|ollama` → Pi-native provider matrix (Anthropic / OpenAI / OpenRouter / Google / Bedrock / Ollama).
- Vocabulary: `reasoning_effort` → `thinking_level` (Pi-native: `off | minimal | low | medium | high | xhigh`).
- QA: full LLM verification → static-check ladder (typecheck/lint/format/tests) → LLM escalation on failure.
- The methodology surface (six SDLC roles, phase lifecycle, artefact pipeline) is preserved verbatim.

---

## Design + decisions

The authoritative design document for v3 is [`TDD2.md`](./TDD2.md) at the repo root. It supersedes the v2-era TDD.md. Read [`docs/design/README.md`](./docs/design/README.md) for the suggested reading order.

13 Architecture Decision Records anchor v3, indexed at [`docs/decisions/README.md`](./docs/decisions/README.md):

- **Accepted (5)**: ADR-001 (Pi adoption), ADR-002 (Extension result protocol), ADR-003 (provider quirks JSON), ADR-004 (cache_control at provider-shim), ADR-005 (delete drivers wholesale), ADR-010 (reproducible builds — added at M1 PR-11).
- **Proposed (7)**: ADR-006 (cache breakpoint placement), ADR-007 (Budget Gate semantics), ADR-008 (worktree-per-task), ADR-009 (Windows worktree paths), ADR-011 (cassette-only provider matrix), ADR-012 (six-month LTS).
- **Deferred (1)**: ADR-013 (no hosted docs site at v3.0).

Live planning state lives in [`.vbw-planning/`](./.vbw-planning/) — `ROADMAP.md` is the entry point. Per-milestone PR ledger: [`.vbw-planning/v3-tracking.md`](./.vbw-planning/v3-tracking.md).

---

## Troubleshooting

**`swt: command not found` after install**
Your global npm bin directory isn't on `PATH`. Run `npm config get prefix` and add `<prefix>/bin` to your shell rc.

**`swt --version` reports `0.0.0` after a manual rebuild**
You're running a locally-built bundle from before the `CURRENT_VERSION` constant was wired up. Reinstall from npm: `npm install -g stop-wasting-tokens`.

**`swt vibe` keeps asking the same confirmation**
Your `autonomy` is set to `cautious` or `standard` (the default). Switch with `swt config set autonomy confident` to auto-chain phases, or `pure-vibe` to auto-loop until a hard error.

**Phase detection is in a weird state**
Run `swt detect-phase` for a JSON dump of what SWT thinks the state is. The `phase_detect_error=true` line points at root cause.

**`swt doctor` reports `Pi runtime not available`**
Pi is declared as a peer-dep (`^0.74.0`); ensure `@earendil-works/pi-coding-agent` is installed in your project or globally. Source installs from `main` include it via `pnpm install`.

**Tests failing on chokidar 4 fsevents (macOS)**
The PR-17 chokidar v4 upgrade fixed the glob-support drop; one remaining test (sse-snapshot-changed) is skipped under umbrella issue #32 pending a chokidar v4 close-handler fix or fs.watch migration.

---

## Contributing, security, license

- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security disclosures: [SECURITY.md](SECURITY.md).
- License: MIT, see [LICENSE](LICENSE).

Active development of v3 happens on `main`. v2 stable patches land on [`v2-archive`](https://github.com/swt-labs/stop-wasting-tokens/tree/v2-archive). v3.0.0 cuts from `main` at the M6 release gate.
