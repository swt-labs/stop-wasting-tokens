# stop-wasting-tokens

[![npm](https://img.shields.io/npm/v/stop-wasting-tokens.svg)](https://www.npmjs.com/package/stop-wasting-tokens)
[![CI](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml/badge.svg)](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> A spec-driven harness for the OpenAI Codex CLI, built around a single obsession: **stop wasting tokens**.

`swt` is a Node/TypeScript CLI you install once. It wraps every Codex session in a six-agent software development lifecycle, persistent planning artefacts, and goal-backward verification — so the model never re-discovers what you already specified, never improvises past a documented plan, and never burns turns on work the spec doesn't ask for.

If you've ever watched Codex re-read your codebase three times in one session, hallucinate an architecture you already rejected, or chase a fix in circles because the goal drifted mid-stream — that's the waste this tool is engineered to eliminate.

---

## Table of contents

- [What "saving tokens" actually means](#what-saving-tokens-actually-means)
- [How SWT works](#how-swt-works)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Verify the install](#verify-the-install)
- [Quick start: a real session](#quick-start-a-real-session)
- [The methodology](#the-methodology)
- [Configuration](#configuration)
- [Command reference](#command-reference)
- [Troubleshooting](#troubleshooting)
- [Status](#status)
- [Contributing, security, license](#contributing-security-license)

---

## What "saving tokens" actually means

Token waste in AI coding has five concrete sources. SWT is designed to attack each one:

| Waste source | Without SWT | With SWT |
|---|---|---|
| Re-reading project context every turn | Codex re-greps, re-globs, re-reads files it saw 5 minutes ago | Stable cache-prefix prompts; durable `.swt-planning/` artefacts persist between turns |
| Re-discovering architecture & decisions | Each session starts cold, re-derives constraints, re-debates trade-offs | `PROJECT.md`, `REQUIREMENTS.md`, `STATE.md` are read once and stay cached for the whole milestone |
| Improvised approaches that get rejected | Model proposes, you correct, model re-proposes — three turns gone | Plans are written by Architect/Lead **before** Dev gets the keys; rejected approaches are recorded in `ASSUMPTIONS.md` |
| Goal drift mid-execution | "While I was at it, I also refactored…" — the dreaded scope explosion | Goal-backward QA verifies output against the **specified** plan, not against improvised goals |
| Re-running QA from scratch on small fixes | Full validation matrix every time | Three QA tiers (`quick` / `standard` / `deep`) plus a `fix` lane that targets only the failed acceptance criterion |

Every design decision in SWT — split prompts, pinned model profiles per agent, the phase artefact pipeline, the verification tiers, even the file-locking system — is downstream of "minimize tokens spent per shipped acceptance criterion."

---

## How SWT works

In one sentence: **you write a spec, SWT turns it into a plan, six specialist agents execute the plan, and a verification stage compares output to the spec before anything ships.**

```
   You write              SWT turns it into        Six agents execute        Output is verified
   ─────────              ─────────────────        ──────────────────        ─────────────────
   PROJECT.md             ROADMAP.md (phases)      Scout    → research        QA tier
   REQUIREMENTS.md        PHASE/PLAN.md (tasks)    Architect → design         Goal-backward
                                                   Lead     → coordinate      Acceptance criteria
                                                   Dev      → implement       UAT scenarios
                                                   QA       → verify
                                                   Debugger → resolve
```

Each agent has a fixed model profile and reasoning effort tuned for its role (Scout uses `gpt-5.5/low`, Architect uses `gpt-5.5/high`, Dev uses `gpt-5.3-codex/medium`, etc). You don't think about model selection — the methodology does.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | `>= 20.18` | Runtime for the `swt` CLI itself |
| **OpenAI Codex CLI** | `>= 0.124.0` | The backend SWT orchestrates against |
| **Git** | any recent | Phase commits, milestone tags, the pre-push hook |
| One of: **npm 10+**, **pnpm 9+**, **bun 1+** | — | Pick whichever you already use |

Optional but recommended:

- **`jq`** — used by some helper scripts; `brew install jq` on macOS, `apt install jq` on Linux.
- **A terminal with 256-color + Unicode support** — `swt watch` renders an Ink TUI dashboard.

To check Codex is installed and reachable:

```bash
codex --version
```

If the Codex CLI isn't installed, follow the OpenAI install guide first — SWT is a methodology layer; it doesn't ship its own model runtime.

---

## Install

Install once, globally:

```bash
# npm
npm install -g stop-wasting-tokens

# pnpm
pnpm add -g stop-wasting-tokens

# bun
bun add -g stop-wasting-tokens
```

That's it. The package ships an ESM-only bundle with a single `swt` binary. No build step, no peer-dependency negotiation, no native modules.

### What the package contains

The published tarball is ~1.3 MB compressed and includes:

- `dist/cli.mjs` — the bundled CLI (single file, ~2.1 MB)
- `dist/cli.d.ts` — TypeScript declarations for programmatic consumers
- `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`

Everything reachable from the CLI entry point is bundled in. There are no transitive runtime dependencies installed alongside.

---

## Verify the install

After install, run:

```bash
swt --version          # should print: swt 1.5.1 (or whatever you installed)
swt --help             # should list ~30 commands
swt doctor             # checks: Node version, Codex CLI, jq, git
```

`swt doctor` is the one-shot environmental check. If anything's missing or out-of-version it tells you exactly what to fix.

---

## Quick start: a real session

This is what a typical first hour with SWT looks like.

### 1. Bootstrap a project (`swt init`)

In an empty directory or an existing repo:

```bash
swt init
```

Interactively walks you through:

- Confirming or auto-detecting the tech stack (Node? Python? Rust? Mixed?)
- Naming the project
- Capturing 3–5 high-level requirements
- Choosing your defaults: `effort` (`thorough` / `balanced` / `fast` / `turbo`), `autonomy` (`cautious` / `standard` / `confident` / `pure-vibe`), `verification_tier` (`quick` / `standard` / `deep`)

Result: a populated `.swt-planning/` directory with `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, and a `config.json` capturing your defaults.

### 2. Map an existing codebase (`swt map`, brownfield only)

If you ran `swt init` in an existing repo, follow up with:

```bash
swt map
```

This generates `.swt-planning/codebase/` with `STACK.md`, `ARCHITECTURE.md`, `PATTERNS.md`, `CONCERNS.md` — a dense, cache-friendly snapshot of what's already there. Subsequent agent calls read this once and reference it for the whole milestone instead of re-grepping.

### 3. Plan and execute the next phase (`swt vibe`)

```bash
swt vibe
```

`vibe` is the orchestrator. It detects what state you're in (no plan? planned but not built? built but not verified? verified but not archived?) and routes you to the right next step. In the common "fresh project" case:

- Spawns **Scout** for ambient research
- Spawns **Architect** for design decisions
- Asks you to confirm scope before any code is written
- Spawns **Lead** to break the phase into atomic tasks
- Spawns **Dev** to execute each task with one commit per task
- Spawns **QA** to verify against the goal-backward acceptance criteria
- Asks you to confirm UAT before declaring the phase complete

You can short-circuit to a specific stage with `swt plan`, `swt execute`, `swt qa`, or `swt vibe --plan=03`.

### 4. Inspect progress at any time

```bash
swt status               # current phase, milestone, % complete
swt detect-phase --json  # machine-readable state (used by the statusline / IDE plugins)
swt watch                # interactive TUI dashboard scoped to the active milestone
```

### 5. Archive a completed milestone

When all phases in a milestone pass UAT:

```bash
swt archive
```

Archives `.swt-planning/phases/*` into `.swt-planning/milestones/<NN>-<slug>/`, runs the 7-point pre-archive audit, generates `RELEASE-NOTES.md`, and tags the commit if `auto_push` is configured.

### 6. Other common entry points

```bash
swt research "How does feature X interact with Y?"     # Scout-only pass; saves to RESEARCH.md
swt fix "auth flow rejects valid tokens"               # quick-fix lane for a single failing UAT scenario
swt debug "the test in foo.spec.ts fails intermittently"  # hypothesis-driven debugging
swt todo add "investigate caching bug"                 # add a backlog item to STATE.md
swt update                                             # check npm for a newer version
```

---

## The methodology

### The six agents

| Agent | Model profile | Reasoning effort | Job |
|---|---|---|---|
| **Scout** | `gpt-5.5` | `low` | Ambient research, codebase queries, doc fetches |
| **Architect** | `gpt-5.5` | `high` | Design decisions, trade-off analysis, scope shaping |
| **Lead** | `gpt-5.3-codex` | `medium` | Plans phases into atomic tasks; one commit per task |
| **Dev** | `gpt-5.3-codex` | `medium` | Executes tasks; writes code, tests, docs |
| **QA** | `gpt-5.3-codex` | `medium` | Goal-backward verification against acceptance criteria |
| **Debugger** | `gpt-5.3-codex` | `high` | Hypothesis-driven root-cause analysis when QA fails |

You can override profiles per-project in `.swt-planning/config.json`, but the defaults are tuned to balance cost, latency, and quality for typical workloads.

### The phase lifecycle

Every phase goes through five states:

```
needs_discussion  →  needs_plan_and_execute  →  needs_execute  →  needs_verification  →  archived
     (optional)              ↑                       ↑                  ↓
                             └──── if user           └──── if QA        └──── if UAT issues
                                  rejects scope            fails              found by user
```

`swt vibe` reads `STATE.md` + on-disk artefacts, computes the current state, and routes to the right command. Manual flags (`--plan`, `--execute`, `--verify`, `--archive`) bypass auto-routing when you want to be explicit.

### The artefact pipeline

```
.swt-planning/
├── PROJECT.md              ← what we're building (you write this)
├── REQUIREMENTS.md         ← validated + active + out-of-scope (you write this)
├── ROADMAP.md              ← milestones → phases (Architect generates, you approve)
├── STATE.md                ← current phase, milestone, todos (machine-managed)
├── config.json             ← effort, autonomy, model profiles (you tune)
├── codebase/               ← brownfield map (swt map output)
│   ├── STACK.md
│   ├── ARCHITECTURE.md
│   ├── PATTERNS.md
│   └── CONCERNS.md
├── phases/
│   └── 01-{slug}/
│       ├── ASSUMPTIONS.md  ← discussion outputs
│       ├── PLAN.md         ← Lead's task breakdown
│       ├── RESEARCH.md     ← Scout's findings
│       ├── VERIFICATION.md ← QA's contract verification
│       └── UAT.md          ← user acceptance scenarios
└── milestones/             ← archived phases, frozen
    └── 01-{slug}/
```

Artefacts are read at the **start** of each agent call as part of the cache-stable prefix. Token cost: paid once per file, amortised across every turn in the milestone.

---

## Configuration

Live config lives in `.swt-planning/config.json` and is editable directly or via `swt config set <key> <value>`.

The knobs that matter most:

| Key | Values | Default | Effect |
|---|---|---|---|
| `effort` | `thorough` / `balanced` / `fast` / `turbo` | `balanced` | Planning depth and verification thoroughness; also a turn-budget scalar (1.5× → 0.6×) applied to every agent |
| `autonomy` | `cautious` / `standard` / `confident` / `pure-vibe` | `standard` | How aggressively `swt vibe` advances without prompts. `cautious` stops every stage; `pure-vibe` auto-loops everything until a hard error |
| `verification_tier` | `quick` / `standard` / `deep` | `standard` | What QA runs. `quick` = smoke + lint + types; `standard` = +unit tests + must-have evidence; `deep` = +integration + cross-phase traceability |
| `model_profile` | `quality` / `balanced` / `cost` | `quality` | Coarse cost/quality switch applied across all six agents |
| `backend` | `codex` / `claude-code` / `ollama` | `codex` | Which CLI runtime SWT orchestrates against (Codex is fully shipped; Claude Code and Ollama drivers land in v1.6+) |
| `prefer_teams` | `auto` / `always` / `never` | `auto` | Use parallel agent teams (when supported by your Codex CLI version) |
| `auto_uat` | `true` / `false` | `false` | When QA passes, auto-route into UAT (`true`) or stop and ask (`false`) |
| `auto_push` | `never` / `after_phase` / `always` | `never` | When to push commits to `origin` |
| `planning_tracking` | `manual` / `ignore` / `commit` | `manual` | How `.swt-planning/` interacts with git: `manual` (you decide), `ignore` (gitignored), `commit` (auto-commit at planning checkpoints) |
| `agent_max_turns.{role}` | int | varies | Per-agent turn cap. Defaults: scout 15, qa 25, architect 30, lead 50, dev 75, debugger 80 |
| `model_overrides.{role}` | string | none | Override the model for a specific agent (e.g. force the Architect onto a cheaper model for a low-stakes project) |

Advanced blocks (not usually edited by hand): `telemetry`, `marketplace`, `hooks`. Run `swt config show` for the full live config.

---

## Command reference

The CLI exposes ~30 commands. The full reference (with examples and flag details) is in [docs.stopwastingtokens.dev](https://docs.stopwastingtokens.dev). Quick index:

**Lifecycle** `init` `vibe` `plan` `execute` `verify` `archive`
**Quality** `qa` `fix` `debug` `audit`
**Inspection** `status` `detect-phase` `watch` `whats-new`
**Backlog** `todo` `phase` `assumptions`
**Research** `research` `discuss`
**Workspace** `map` `worktree` `lease` `pause` `resume`
**Maintenance** `doctor` `config` `skills` `update` `uninstall` `release` `version`

Every command supports `--help`:

```bash
swt vibe --help
swt qa --help
```

---

## Troubleshooting

**`swt: command not found` after install**
Your global npm bin directory isn't on `PATH`. Run `npm config get prefix` and add `<prefix>/bin` to your shell rc.

**`swt --version` reports `0.0.0` after a manual rebuild**
You're running a locally-built bundle from before the `CURRENT_VERSION` constant was wired up. Reinstall from npm: `npm install -g stop-wasting-tokens`.

**`swt vibe` keeps asking the same confirmation**
Your `autonomy` is set to `cautious` or `standard` (the default). Switch with `swt config set autonomy confident` to auto-chain phases, or `pure-vibe` to auto-loop until a hard error.

**Phase detection is in a weird state**
Run `swt detect-phase` for a JSON dump of what SWT thinks the state is. The `phase_detect_error=true` line points at root cause. As a last resort, `swt pause` saves your in-progress work and lets you restart cleanly.

**Codex CLI says it can't find `~/.codex/config.toml [mcp_servers.swt]`**
The agent TOMLs reference `~/.codex/config.toml` (the documented Codex MCP path). If you're on an older Codex setup that uses `~/.codex/mcp.json`, upgrade Codex (`>= 0.124.0`).

**Lots of CI failures right after a push**
Check whether you're using v1.5.0 or earlier — the build pipeline didn't actually compile until v1.5.1. Update with `npm install -g stop-wasting-tokens@latest`.

---

## Status

Currently shipping **v1.5.1**. v1 milestones (1–15) are complete. v1.5 forward-compatibility is in place for additional backend drivers (Claude Code, Ollama) — see [`docs/roadmap/v1.5.md`](docs/roadmap/v1.5.md). v1 itself targets the Codex CLI only.

Per-version changes are tracked in [CHANGELOG.md](CHANGELOG.md). Stable release notes are in [RELEASE-NOTES-v1.0.md](RELEASE-NOTES-v1.0.md).

---

## Contributing, security, license

- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security disclosures: [SECURITY.md](SECURITY.md).
- License: MIT, see [LICENSE](LICENSE).
