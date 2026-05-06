# Stop Wasting Tokens (SWT) — Conversion Plan from VBW

**Repository:** `https://github.com/swt-labs/stop-wasting-tokens`
**Sunsets:** `https://github.com/yidakee/vibe-better-with-claude-code-vbw` (VBW)
**Owner:** Tiago Serôdio (@yidakee), Lisbon
**Date drafted:** 5 May 2026
**Status:** Reference plan — no code, no fixed deadline, no compromises

---

## TL;DR

- **SWT is a Codex‑first, methodology‑first reimagining of VBW** — same six‑agent lifecycle and goal‑backward verification, but built as a Node/TypeScript CLI distributed via npm and grounded in the OpenAI Codex CLI's own primitives (TOML agents, AGENTS.md, Skills, Hooks, Plugins). v1 is CLI‑only and Codex‑only. v1.5 introduces a UI/dashboard and a multi‑backend driver layer (Claude Code, Ollama).
- **The brand promise — "Stop Wasting Tokens" — is technical, not marketing.** SWT borrows the Claude Code source‑leak's most useful architectural patterns (cache‑aware split prompts, three subagent execution models, compaction circuit breakers, MEMORY.md self‑healing memory, structured handoffs) and re‑expresses them on Codex without ever touching leaked code.
- **VBW will be hard‑sunset.** This plan is exhaustive: 12 phases, every dependency named, every VBW concept mapped to a Codex‑native equivalent, every Claude Code limitation called out (slash commands don't auto‑invoke on Codex — Issue #4311 — so SWT delivers methodology through Skills + AGENTS.md + custom prompts, not `/swt:*` commands).

---

## A. EXECUTIVE SUMMARY

VBW (Vibe Better With Claude Code) is a Claude Code plugin that bolts a real software‑development lifecycle onto vibe coding sessions: 27 slash commands, 6 specialised agents (Scout, Architect, Lead, Dev, QA, Debugger), 18 hooks across 10 event types, structured JSON handoff schemas, effort/autonomy profiles, and persistent artifacts under `.vbw-planning/`. It works — but it is locked to Anthropic's runtime, written entirely in Bash (macOS/Linux only, WSL on Windows), and shaped around Claude Code's specific feature set (Agent Teams, SendMessage peer messaging, model‑driven SlashCommand auto‑invocation).

**SWT (Stop Wasting Tokens)** is a fresh start, not a rename. It keeps VBW's *methodology* — phased planning, goal‑backward QA, atomic commits, governed agent specialisation, persistent project artifacts — and rebuilds the *engine* around the OpenAI Codex CLI as the v1 backend. It is written in Node/TypeScript, distributed via npm (`npm i -g stop-wasting-tokens`), and built so that Claude Code, Ollama, and other backends can be added in v1.5 without rewriting the methodology layer.

**Why now.** Three things changed in the last six months:
1. Codex CLI grew genuine first‑class extension surfaces — TOML subagents, Skills, Plugins/Marketplaces, lifecycle Hooks (PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, PermissionRequest, Stop), MCP servers, and `codex mcp` server mode — making it credible as a methodology platform, not just a chat agent. The release notes for openai/codex v0.124.0 (23 April 2026) explicitly state that "Hooks are now stable, can be configured inline in config.toml and managed requirements.toml, and can observe MCP tools as well as apply_patch and long-running Bash sessions."
2. The Claude Code source leak — security researcher Chaofan Shou (@Fried_rice, Solayer Labs) posted at ~4:23 AM ET on 31 March 2026 that v2.1.88 of `@anthropic-ai/claude-code` shipped a 59.8 MB `cli.js.map` exposing ~512,000 lines of TypeScript across ~1,906 files; Anthropic confirmed it was "a release packaging issue caused by human error, not a security breach." Named secondary analyses (VentureBeat, layer5.io, sabrina.dev, claudefa.st) make architectural patterns legible without ever touching the leaked source itself.
3. The methodology‑layer space has stratified: BMAD (heavy multi‑agent), GitHub Spec Kit (lightweight constitution + spec/plan/tasks/implement slash flow), OpenSpec (brownfield change proposals), OpenCode (model‑agnostic agent), OMX/oh‑my‑codex (Codex orchestration). None of them combines Codex‑native primitives with VBW's lifecycle discipline. SWT does.

**How SWT differs from VBW.**
- **Backend‑agnostic from day one in *positioning*, Codex‑only in *code* until v1.5.** Four core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore) keep the methodology portable.
- **Methodology‑first.** Skills + AGENTS.md + structured artefacts replace `/vbw:*` slash commands, because Codex does not auto‑invoke custom slash commands from model output (GitHub Issue openai/codex#4311) and custom prompts are now deprecated in favour of Skills.
- **Structured cost discipline baked into the brand.** Every plan exposes token cost, every cache boundary is intentional, every agent has a model profile.
- **Cross‑platform.** Node/TypeScript, no Bash hard dependency, Windows works natively (with caveats around Codex hooks on Windows).

---

## B. ARCHITECTURE OVERVIEW

### B.1 High‑level system, in prose

A user invokes `swt <verb>` (e.g. `swt init`, `swt plan`, `swt execute`). The CLI loads a typed configuration (Zod‑validated TOML/JSON), resolves the active *backend driver* (in v1: the Codex driver; in v1.5+: also Claude Code, Ollama, etc.), composes a *system prompt* with a clean cache boundary, and calls one of four core abstractions to do work:

- **HookHost** — registers, dispatches, and observes lifecycle events. On Codex it writes to `~/.codex/hooks.json` or to the project `.codex/hooks.json` (PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, PermissionRequest, Stop). On Claude Code (v1.5) it would target the 12‑event hook taxonomy via Claude Code's settings file.
- **AgentSpawner** — turns a methodology *role* (Scout, Architect, Lead, Dev, QA, Debugger) into a backend‑specific spawn. On Codex it writes TOML files under `~/.codex/agents/` (user) or `.codex/agents/` (project), wires `[agents]` in `config.toml` (with `agents.max_threads` defaulting to 6 and `agents.max_depth` defaulting to 1), and surfaces them via `/agent`.
- **PermissionGate** — a backend‑agnostic permission validator. On Codex it composes sandbox modes (`read-only`, `workspace-write`, `danger-full-access`), approval policies (`untrusted`, `on-request`, `never`), and named permission profiles. It also implements a SWT‑level Bash safety pre‑filter (clean‑room, modelled on the *idea* of Claude Code's bash security checks, never on the leaked code) before delegating to the backend's own sandbox.
- **MemoryStore** — manages the SWT memory model: `MEMORY.md` (lightweight always‑on index ≤ 200 lines), topic files referenced by index, project artefacts under `.swt-planning/`, and structured handoff JSON blobs. Backed in v1 by Codex sessions storage (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) and `codex resume` for continuity.

The *methodology layer* sits above these four abstractions. It is the part the user actually experiences:

- **Skills** (Codex‑native, SKILL.md format with `name` and `description` frontmatter) are SWT's primary delivery mechanism for opinionated workflows. They auto‑match on user prompts thanks to Codex's discovery meta‑skill.
- **AGENTS.md** (root + nested) carries always‑on conventions and effort‑profile defaults, with attention paid to the 32 KiB `project_doc_max_bytes` truncation cap so that nested overrides in deep paths still load.
- **Custom prompts** in `~/.codex/prompts/` (deprecated by OpenAI in favour of Skills, but still functional) provide explicit `/swt:*` commands as a transitional ergonomic — never relied on for auto‑invocation.
- **Agent TOML files** under `.codex/agents/` define each role (Scout, Architect, Lead, Dev, QA, Debugger) with its own `model`, `model_reasoning_effort`, `sandbox_mode`, allowed `mcp_servers`, and `developer_instructions`.
- **Plugin manifest** (`.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`) packages SWT for distribution via the Codex Plugin Marketplace once the npm path is solid.
- **Artefacts engine** writes `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `phases/<n>/PLAN.md`, `phases/<n>/SUMMARY.md`, and `milestones/` to disk; these are the source of truth between sessions.

### B.2 Mapping the four abstractions to backends

- **Codex (v1)**:
  - HookHost → `hooks.json` + inline `[hooks]` in `config.toml`. Stable events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop. **Known gaps**: PreToolUse fires reliably for Bash but historically not for `apply_patch` or many MCP calls (openai/codex#16732), and PreToolUse `additionalContext` injection is not supported (openai/codex#19385). Codex v0.124.0 stabilised hook coverage further; SWT must accept these gaps for older Codex installs and design around them.
  - AgentSpawner → TOML files (one per agent), `[agents]` block, `/agent` switching.
  - PermissionGate → `sandbox_mode` + `approval_policy` + `[permissions.<name>]` profiles + `[shell_environment_policy]` + `requirements.toml` for managed environments.
  - MemoryStore → `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `codex resume` + AGENTS.md + Skills + `.swt-planning/` artefacts + the SWT MEMORY.md index.
- **Claude Code (v1.5+, design only)**:
  - HookHost → 12 hook events including PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop, SubagentStop, PreCompact, Notification, TeammateIdle, TaskCompleted (mapping needed; SWT's six‑event Codex contract is a lossy subset).
  - AgentSpawner → Claude Code subagents (markdown frontmatter), Agent Teams, isolation modes (default / fork / worktree).
  - PermissionGate → `permissions` in `settings.json`, `--dangerously-skip-permissions`, allow/deny lists.
  - MemoryStore → CLAUDE.md, `.claude/` dirs, conversation transcripts.
- **Ollama / open‑source (v1.5+, design only)**:
  - HookHost → user‑space wrapper around the OSS provider's tool calls; many lifecycle events do not exist natively and would have to be synthesised by SWT.
  - AgentSpawner → process‑level fan‑out using `execa` and per‑process system prompts.
  - PermissionGate → SWT‑side gate, since open backends lack a sandbox.
  - MemoryStore → fully SWT‑managed (no provider session log to lean on).

### B.3 SWT repo layout (`swt-labs/stop-wasting-tokens`)

```
stop-wasting-tokens/
├── .changeset/                     Changesets pending releases
├── .github/
│   ├── workflows/                  CI: typecheck, test, lint, release
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── .codex-plugin/
│   └── plugin.json                 Codex plugin manifest (for marketplace)
├── .agents/
│   └── plugins/marketplace.json    Repo-scoped marketplace entry
├── .vscode/                        Recommended settings (formatter on save)
├── docs/                           Mintlify or Docusaurus content
│   ├── getting-started/
│   ├── concepts/                   Methodology layer, abstractions, glossary
│   ├── reference/                  Commands, config keys, hook events
│   └── recipes/                    Patterns, model profiles, monorepos
├── packages/
│   ├── core/                       Type definitions, abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore)
│   ├── cli/                        The `swt` binary, command surface
│   ├── codex-driver/               Codex backend implementation
│   ├── methodology/                The 6 agents, skills, prompt builders
│   ├── artifacts/                  PROJECT/REQUIREMENTS/ROADMAP/STATE engine
│   ├── verification/               QA pipeline, goal-backward checks
│   └── telemetry/                  Opt-in metrics (privacy-respecting)
├── skills/                         Source-of-truth SKILL.md files for distribution
│   ├── swt-init/
│   ├── swt-plan/
│   ├── swt-execute/
│   ├── swt-qa/
│   ├── swt-map/
│   └── swt-debug/
├── agents-templates/               Source TOML agent definitions
│   ├── scout.toml
│   ├── architect.toml
│   ├── lead.toml
│   ├── dev.toml
│   ├── qa.toml
│   └── debugger.toml
├── prompts/                        Optional /swt:* custom prompts (transitional)
├── hooks/                          Hook handler scripts (cross-platform Node)
│   ├── security-filter.mjs
│   ├── file-guard.mjs
│   ├── summary-validator.mjs
│   ├── commit-format.mjs
│   └── compaction-injector.mjs
├── tests/                          Vitest suites; integration tests use mocked Codex
├── examples/                       Sample projects exercising SWT
├── scripts/                        Release scripts, doc-gen, fixture generators
├── AGENTS.md                       Root project instructions for Codex contributors
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE                         MIT
├── README.md
├── SECURITY.md
├── package.json
├── tsconfig.base.json
├── tsup.config.ts                  Build config
├── vitest.config.ts
├── .eslintrc.cjs / eslint.config.mjs
├── .prettierrc
└── pnpm-workspace.yaml
```

### B.4 What `swt init` creates in a user's project

```
<project>/
├── .swt/                           Runtime state, locks, snapshots
│   ├── config.toml                 Local SWT config (effort, autonomy, profiles)
│   ├── .locks/                     Per-task file ownership lease locks
│   ├── .metrics/run-metrics.jsonl  Token cache hit/miss, timings (opt-in)
│   ├── .snapshots/                 Crash-recovery snapshots
│   └── memory/
│       └── MEMORY.md               Always-on index, ≤ 200 lines
├── .swt-planning/                  Methodology artefacts (committed)
│   ├── PROJECT.md
│   ├── REQUIREMENTS.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── phases/
│   │   ├── 01-foundation/
│   │   │   ├── PLAN.md
│   │   │   ├── SUMMARY.md
│   │   │   └── VERIFICATION.md
│   │   └── ...
│   └── milestones/
├── .codex/
│   ├── agents/                     6 SWT agent TOMLs (project-scoped)
│   ├── hooks.json                  SWT hook wiring
│   ├── config.toml                 Optional [agents], [permissions], [features] overrides
│   └── prompts/                    Optional /swt:* custom prompts
├── AGENTS.md                       SWT-managed project instructions (with a CLEARLY MARKED `<!-- SWT -->` block; rest of file is user-owned)
└── .gitignore                      Adds `.swt/.locks/`, `.swt/.snapshots/`, etc.
```

### B.5 The "methodology layer" concept

A **methodology layer** is everything between the raw model+tools surface (Codex CLI, Claude Code) and the user's task. It is the opinionated rules — phasing, planning, role separation, verification cadence, artefact shape — that turn an "agent that can do anything" into a "team that ships well and cheaply". SWT's wager is that methodology, not model choice, is what makes vibe coding ship‑grade. The four abstractions exist precisely to keep that methodology layer portable.

---

## C. NAMING & TERMINOLOGY MIGRATION

### C.1 Concept‑to‑concept map

| VBW | SWT | Notes |
|---|---|---|
| `vbw` (binary) | `swt` (binary) | Distributed via npm |
| `.vbw-planning/` | `.swt-planning/` | Same artefact taxonomy |
| `vbw-planning/PROJECT.md` | `.swt-planning/PROJECT.md` | Identical role |
| `vbw-planning/REQUIREMENTS.md` | `.swt-planning/REQUIREMENTS.md` | Identical role |
| `vbw-planning/ROADMAP.md` | `.swt-planning/ROADMAP.md` | Identical role |
| `vbw-planning/STATE.md` | `.swt-planning/STATE.md` | Identical role |
| `phases/`, `milestones/` | `phases/`, `milestones/` | Identical |
| `CLAUDE.md` injection | `AGENTS.md` injection (Codex‑native) | Honour `project_doc_max_bytes`; nested `AGENTS.override.md` for per‑subdir tweaks |
| Claude Code Plugin | Codex Plugin (`.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`) | Plus npm package as primary distribution |
| `/vbw:init` | `swt init` (CLI) **and** `$swt-init` skill | Skill auto‑matches relevant prompts |
| `/vbw:vibe` (or `/vbw:implement`) | `swt vibe` **and** `$swt-vibe` skill | Smart router |
| `/vbw:plan` | `swt plan [phase]` **and** `$swt-plan` skill | |
| `/vbw:execute` | `swt execute [phase]` **and** `$swt-execute` skill | |
| `/vbw:qa` | `swt qa [phase]` **and** `$swt-qa` skill | |
| `/vbw:status` | `swt status` (CLI only — no model invocation needed) | Direct file read |
| `/vbw:config` | `swt config` (CLI only) | Direct file edit |
| `/vbw:profile` | `swt profile` (CLI subcommand of config) | |
| `/vbw:doctor` | `swt doctor` (CLI only) | Health checks |
| `/vbw:map` | `swt map` **and** `$swt-map` skill | 4 parallel Scouts |
| `/vbw:debug` | `swt debug` **and** `$swt-debug` skill | |
| `/vbw:fix` | `swt fix` (CLI shortcut for turbo profile) | |
| `/vbw:archive` | `swt archive` | |
| `/vbw:release` | `swt release` | |
| `/vbw:resume` | `swt resume` (also leverages `codex resume`) | |
| `/vbw:pause` | `swt pause` | |
| `/vbw:audit` | `swt audit` | |
| `/vbw:assumptions` | `swt assumptions` | |
| `/vbw:research` | `swt research` | |
| `/vbw:discuss` | `swt discuss` | |
| `/vbw:add-phase` / `insert-phase` / `remove-phase` | `swt phase add` / `swt phase insert` / `swt phase remove` | Subcommands |
| `/vbw:todo` | `swt todo` | |
| `/vbw:skills` | `swt skills` | Browses Skills.sh + curated mappings |
| `/vbw:whats-new` | `swt whats-new` | |
| `/vbw:update` | `swt update` (npm‑aware) | |
| `/vbw:uninstall` | `swt uninstall` | |
| `/vbw:help` | `swt help` / `swt --help` | |
| Scout, Architect, Lead, Dev, QA, Debugger | Same names | First‑class methodology vocabulary |
| `effort` (thorough/balanced/fast/turbo) | `effort` (thorough/balanced/fast/turbo) | Identical knob |
| `autonomy` (cautious/standard/confident/dangerously‑vibe) | `autonomy` (cautious/standard/confident/dangerously‑vibe) | Identical knob; SWT also exposes Codex `approval_policy` translation |
| `verification_tier` (quick/standard/deep/skip) | `verification_tier` (quick/standard/deep/skip) | Identical |
| Effort profiles: default/prototype/production/yolo | Same names | |
| Model profiles: quality/balanced/budget | Same names; Codex‑aware (gpt‑5.5 / gpt‑5.4 / gpt‑5‑codex‑mini) | |
| `scout_findings`, `dev_progress`, `dev_blocker`, `qa_result`, `debugger_report` JSON schemas | Same five schemas, plus a new `handoff_envelope` wrapper for cache‑aware framing | |
| Skills.sh integration | Skills.sh integration **and** Codex curated/experimental skills (openai/skills) | |
| Hooks: PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, PreCompact, Stop, Notification, SubagentStop, TeammateIdle, TaskCompleted (10 event types) | **Codex available**: PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, PermissionRequest, Stop (6 event types). PreCompact/SubagentStop/TeammateIdle/TaskCompleted have **no Codex equivalent in v1** and must be either dropped, polyfilled in user space, or deferred to v1.5 | |
| `bash_guard` | `swt bash-guard` (cross‑platform Node implementation) | |
| `file-guard.sh` | `swt file-guard` | |
| `security-filter.sh` | `swt security-filter` | |
| `lease-lock.sh` | `swt lease` | |
| `worktree-*.sh` | `swt worktree` (subcommands) | |
| `VBW_ALLOW_DESTRUCTIVE=1` | `SWT_ALLOW_DESTRUCTIVE=1` | |
| `.vbw-planning/destructive-commands.local.txt` | `.swt-planning/destructive-commands.local.txt` | Same idea |
| Statusline integration | `swt status --statusline` (Codex `/statusline`) | |

### C.2 What replaces `/vbw:*` slash commands when Codex doesn't auto‑invoke them?

**The hard constraint:** OpenAI Codex CLI does not allow the model to invoke custom slash commands from its output. Per GitHub Issue openai/codex#4311, "the CLI still treats assistant initiated `/command` text as plain chat, including in `codex exec`, which blocks scripted workflows." Custom prompts in `~/.codex/prompts/` work only when the *human* types them. OpenAI has further deprecated custom prompts in favour of Skills.

**SWT's three‑layer strategy:**

1. **Skills are the primary delivery mechanism.** Each major SWT verb gets a SKILL.md with a precise, trigger‑rich `description` so Codex's discovery meta‑skill auto‑matches user prompts. Codex's documented behaviour is that it loads only the index (name+description) into the system prompt and reads the full `SKILL.md` body only when the skill fires, keeping context lean.

2. **AGENTS.md (root + nested) injects always‑on context.** Codex concatenates AGENTS.md from the global home down to the current working directory, with a 32 KiB cap (`project_doc_max_bytes`). SWT writes a **minimal, well‑bounded** SWT block into AGENTS.md (clearly fenced with `<!-- SWT BEGIN -->` / `<!-- SWT END -->` so user content is never overwritten). The block covers: active effort/autonomy/verification, agent role pointers, the names of available `$swt-*` skills, where artefacts live, and the lease‑lock/file‑guard contract.

3. **Custom prompts under `~/.codex/prompts/swt/*.md` provide manual `/swt:*` ergonomics.** Users who *want* to type `/prompts:swt-plan` get the same expansion. SWT generates these on `swt init` for transitional users coming from VBW, but documents them as deprecated and only useful for human invocation.

**Plus the CLI itself.** Many VBW commands don't actually need the model: `/vbw:status`, `/vbw:config`, `/vbw:doctor`, `/vbw:archive`, `/vbw:release`, `/vbw:phase add|remove|insert`, `/vbw:update`, `/vbw:uninstall` are pure file‑and‑process operations. SWT exposes them as native CLI subcommands. They never round‑trip through Codex.

### C.3 Brand vocabulary

**Use:** "stop wasting tokens" (lowercase tagline; not a command); "spec‑driven", "goal‑backward", "phased", "atomic commits", "lifecycle"; "methodology layer", "backend driver", "core abstractions"; "Scout / Architect / Lead / Dev / QA / Debugger"; "effort", "autonomy", "verification tier", "profile"; "Codex‑native", "AGENTS.md", "Skill", "hook", "permission profile"; "vibe coding" (sparingly); "thorough / balanced / fast / turbo"; "cautious / standard / confident / dangerously‑vibe".

**Avoid:** "Claude Code" in v1 user‑facing copy (it's not v1's runtime); "VBW" in present tense after launch — say "the predecessor" or "VBW (deprecated)"; "Plugin" without context — distinguish *Codex Plugin* (a packaging mechanism) from *SWT* (a methodology layer); "Agent" alone — use "subagent" (Codex), "teammate" (only in Claude Code v1.5+ contexts), or "role" (methodology); US‑centric idioms ("home run", "out of the park", "Hail Mary").

---

## D. CODEX‑NATIVE PATTERNS TO ADOPT

### D.1 TOML agent definitions

Each agent ships as a TOML file under `agents-templates/` in the SWT repo, copied to `.codex/agents/<role>.toml` on `swt init`. A complementary `[agents]` block goes into the user's `.codex/config.toml` declaring `max_threads` (default 6, the Codex documented default), `max_depth` (default 1), and per‑role `description` + `nickname_candidates` for `/agent` UI clarity.

- **Scout** — read‑only researcher. `model = "gpt-5-codex-mini"` for cost; `model_reasoning_effort = "medium"`; `sandbox_mode = "read-only"`; `developer_instructions` enforce: cite files and symbols, never propose fixes unless asked, write findings into the `scout_findings` schema. Used as a team of four in `swt map`.
- **Architect** — roadmap writer. `model = "gpt-5.5"` (or whichever frontier model is current at runtime); `model_reasoning_effort = "high"`; `sandbox_mode = "workspace-write"` but constrained via SWT's PermissionGate to only write under `.swt-planning/`; produces `ROADMAP.md`, `REQUIREMENTS.md`.
- **Lead** — planner. `model = "gpt-5.5"`; `model_reasoning_effort = "high"`; writes are limited to plan files. Consumes Scout findings, decomposes into tasks grouped by wave, self‑reviews, emits `PLAN.md` with YAML frontmatter.
- **Dev** — implementer. `model = "gpt-5.4"` for balanced quality/cost; `model_reasoning_effort = "medium"`; `sandbox_mode = "workspace-write"`; full apply_patch + Bash. Run as a fan‑out (multiple Dev agents in parallel via Codex's stable `multi_agent` feature flag).
- **QA** — verifier. `model = "gpt-5-codex-mini"` for cost on the hot path, escalating to `gpt-5.5` for deep tier; `sandbox_mode = "read-only"` — QA must not mutate. Per OpenAI's Help Center Model Release Notes, gpt-5-codex-mini "is a smaller and more cost-effective version of GPT-5-Codex that provides up to 4x more usage as part of your ChatGPT subscription." Bash is allowed (read‑only invocations: `npm test`, `pytest`, etc.). Writes into `VERIFICATION.md`.
- **Debugger** — bug investigator. `model = "gpt-5.5"`; `model_reasoning_effort = "xhigh"` (the Codex Extra High effort introduced with GPT‑5.1‑Codex‑Max for deep reasoning); `sandbox_mode = "workspace-write"`. May spawn 3 parallel Debugger teammates at thorough effort, each with a different hypothesis.

### D.2 AGENTS.md structure (root + nested)

- **Global** (`~/.codex/AGENTS.md`, optional): user‑managed, never touched by SWT.
- **Project root** (`<project>/AGENTS.md`): contains a small SWT‑managed block fenced by `<!-- SWT BEGIN -->` / `<!-- SWT END -->`. Outside the fence, user content is sacrosanct. SWT's block contains: project name, link to `.swt-planning/PROJECT.md`, active effort/autonomy/verification, the six agent role pointers, the names of available `$swt-*` skills, lease‑lock contract, destructive‑Bash policy.
- **Per‑directory** (`<project>/<subsystem>/AGENTS.override.md`): used when a subsystem has different rules. Honours Codex's "override replaces, does not extend" semantics.
- **Size discipline**: SWT's combined block stays under 4 KiB so that `project_doc_max_bytes` truncation never silently drops the SWT block in deep paths. SWT's `swt doctor` checks this and warns.

### D.3 Skills as the primary methodology delivery mechanism

Each SWT verb that benefits from model invocation ships as a skill folder with `SKILL.md` (required) and optional `scripts/`, `references/`, `assets/`. Skills live at `~/.codex/skills/swt-*` for global install, `<project>/.agents/skills/swt-*` for project‑scoped install, or bundled inside the SWT Codex Plugin's `skills/` directory once published.

Skill metadata includes `allow_implicit_invocation = true` (default) so Codex's discovery meta‑skill can match user prompts. For skills that must only be triggered explicitly (e.g. `swt-release`), set it to `false`.

Skills SWT v1 ships: `swt-init`, `swt-vibe`, `swt-plan`, `swt-execute`, `swt-qa`, `swt-map`, `swt-debug`, `swt-discuss`, `swt-research`, `swt-skill-installer-bridge`.

### D.4 Hook event mapping (which VBW hooks survive on Codex v1)

| VBW Event | Codex Equivalent in v1 | What survives |
|---|---|---|
| PostToolUse (SUMMARY validation, commit format, frontmatter, skill dispatch, state update) | **PostToolUse** | Survives; Codex v0.124.0 release notes confirm hooks "can observe MCP tools as well as apply_patch and long-running Bash sessions." |
| SubagentStop (SUMMARY structure on completion) | **No direct equivalent** | Polyfilled by SWT user‑space wrapper. |
| TeammateIdle (structural completion gate) | **No direct equivalent in Codex** | Replaced by SWT‑side completion check between waves. |
| TaskCompleted (commit‑keyword verification) | **PostToolUse + git commit hook** | Survives partially; SWT additionally writes a Git `prepare-commit-msg` or `post-commit` hook. |
| PreToolUse (security filter, file guard, skill dispatch) | **PreToolUse + PermissionRequest** | Survives but: (a) PreToolUse `additionalContext` injection is not supported (openai/codex#19385); (b) older Codex versions had `apply_patch` and MCP gaps (openai/codex#16732, openai/codex#18491). For destructive‑Bash blocking SWT relies on PreToolUse + PermissionRequest. |
| SessionStart (state detect, map staleness, post‑compact verify) | **SessionStart** | Survives. Codex SessionStart supports `additionalContext` injection. |
| PreCompact | **No equivalent** | Polyfilled via UserPromptSubmit + SessionStart with a "approaching context limit" sentinel; full PreCompact parity deferred to v1.5. |
| Stop (session metrics, duration) | **Stop** | Survives. |
| UserPromptSubmit (pre‑flight validation) | **UserPromptSubmit** | Survives. |
| Notification (teammate communication log) | **No direct equivalent** | Replaced by SWT's structured handoff envelope written to `.swt/.metrics/run-metrics.jsonl`. |

### D.5 Plugin / marketplace strategy

- **Primary distribution: npm.** `npm i -g stop-wasting-tokens` puts `swt` on PATH.
- **Secondary distribution: Codex Plugin.** SWT also ships a `.codex-plugin/plugin.json` and a marketplace entry under `.agents/plugins/marketplace.json` so users can `codex plugin marketplace add github:swt-labs/stop-wasting-tokens`. The plugin bundles the Skills folder and the agent TOML templates, but the rich CLI lives in the npm package.
- **Marketplace listing:** once stable, SWT requests a listing on the Codex Plugin Marketplace.

### D.6 Sandbox / permission profile strategy

SWT defines five named permission profiles, each maps to a Codex `sandbox_mode` + `approval_policy` pair:

- `swt:explore` — `sandbox_mode = "read-only"`, `approval_policy = "untrusted"`. For Scout, `swt research`, `swt map`.
- `swt:plan` — `sandbox_mode = "workspace-write"` with `writable_roots = [".swt-planning"]`, `approval_policy = "on-request"`. For Architect and Lead.
- `swt:build` — `sandbox_mode = "workspace-write"`, `approval_policy = "on-request"` at standard autonomy, `"never"` at confident, `"never"` + `network_access = false` at dangerously‑vibe. For Dev and Debugger.
- `swt:verify` — `sandbox_mode = "read-only"` + Bash allowed for QA.
- `swt:release` — `sandbox_mode = "workspace-write"`, `approval_policy = "untrusted"` (every action confirmed).

### D.7 MCP server integration

- SWT does not ship its own MCP servers in v1. It documents how to wire common MCPs (filesystem, git, GitHub, web fetch) and validates them in `swt doctor`.
- v1.5+: SWT may ship a small SWT MCP server (running over stdio via `codex mcp`) exposing structured artefact reads.

---

## E. CLAUDE CODE LEAK PATTERNS WORTH ADOPTING (clean‑room only)

**Sourcing rule for every implementer:** read only secondary public analyses. Never read or copy the leaked TypeScript itself. Document the source for every pattern adopted.

### E.1 Cache‑aware split system prompts (`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`)

- **What it does:** Claude Code splits its system prompt at a `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker into a static prefix (cacheable globally across organizations) and a dynamic suffix (per‑session: CLAUDE.md, git status, current date). Per Anthropic's official product announcement (anthropic.com/news/prompt-caching), prompt caching reduces "costs by up to 90% and latency by up to 85% for long prompts."
- **Why it matters for SWT:** "Stop Wasting Tokens" is the brand promise. Treating the prompt as a layered, cache‑aware structure is the single biggest cost lever.
- **How to implement on Codex without leaked code:** SWT's prompt builder composes a system prompt with three explicit layers separated by ASCII sentinel comments: (1) **Static layer** — agent identity, behavioural rules, tool semantics, structured handoff schemas (changes only on SWT version bump); (2) **Project static layer** — AGENTS.md content, conventions, glossary (changes only when those files change); (3) **Dynamic layer** — current phase, active task, file inventory, time, recent commits. SWT relies on Codex's web_search caching and OpenAI Responses API caching defaults; the explicit layering matches OpenAI's recommended cache‑first ordering. SWT instruments cache hit rates and exposes them in `swt status --metrics`.

### E.2 Subagent execution model trichotomy (Fork / Teammate / Worktree)

- **What it does:** Claude Code supports three subagent isolation modes: Fork (subagent inherits the parent context, byte‑identical, sharing the KV cache so additional tokens are nearly free), Teammate (independent context window, peer messaging via SendMessage), Worktree (also a fresh git worktree on disk for true filesystem isolation).
- **Why it matters for SWT:** The cost economics of multi‑agent fan‑out are dominated by whether the children can share the parent's prompt cache. Codex does not expose a fork primitive, so SWT must approximate.
- **How to implement on Codex:** SWT's AgentSpawner exposes three modes:
  - **`fresh`** (default; equivalent to Codex's normal subagent spawn via `[agents.<role>]`): each subagent gets its own context. Suitable for Scout, QA.
  - **`shared-prefix`** (cache‑maximising): SWT structures the *system prompt* of the spawned subagent so its prefix matches the parent's static + project‑static layers byte‑for‑byte, maximising the chance the OpenAI Responses API or local cache reuses the cached prefix. Whether this hits the same cache as the parent depends on OpenAI's caching internals; SWT instruments and reports.
  - **`worktree`** (filesystem‑isolated): SWT creates a `.swt-worktrees/<phase>-<plan>/` directory using `git worktree add`, points the spawned Codex subagent at it via `--cd` and `--add-dir`, and merges the branch back at completion. This is the same pattern OMX (oh‑my‑codex) uses, validated to work in production with tmux supervision.

### E.3 Permission validator with security checks

- **What it does:** Claude Code's bash permission system (per public analyses, sabrina.dev and kuber.studio) numbers 23 security checks, classifies every command at LOW/MEDIUM/HIGH risk, splits compound shell scripts at `&&`/`;`/`|` boundaries (using a tree‑sitter parser), and evaluates each segment independently — preventing `git add . && rm -rf /` from being approved because `git add` is allowed. Codex itself adopted a similar pattern publicly (see Codex Rules docs).
- **Why it matters for SWT:** SWT's destructive‑Bash policy is core to its trust posture. A naive prefix match is exploitable.
- **How to implement on Codex:** SWT's `bash-guard` (Node, in `hooks/security-filter.mjs`) parses commands using a published Bash parser (`shell-quote` for tokenisation, `bash-parser` or equivalent for AST), splits compound invocations at logical boundaries, applies a denylist of patterns (rm‑rf root, force pushes, db drops, migration resets, key file overwrites), and returns `decision: "deny"` to Codex's PreToolUse hook with a `systemMessage` explaining why. The denylist starts from VBW's own published list and is reviewed by hand. SWT explicitly does **not** copy any classification matrix from leaked Claude Code source; the design is informed by public analyses + Codex's own public Rules behaviour.

### E.4 Compaction circuit breaker

- **What it does:** Per public analyses (particula.tech and others), Claude Code's AutoCompact reserves a 13 K‑token buffer near the context ceiling, generates up to a 20 K‑token structured summary, and **stops trying after 3 consecutive failures** (`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`).
- **Why it matters for SWT:** Without a circuit breaker, a failing compaction will burn tokens forever. Codex has its own compaction in GPT‑5.2‑Codex but exposes no equivalent client‑side breaker.
- **How to implement on Codex:** SWT tracks a per‑session `compaction_failure_count` in `.swt/.metrics/`. When SWT detects (via UserPromptSubmit hook) that the user prompt is asking Codex to compact and the previous turn's compaction did not produce a useful summary (heuristic: summary < 200 tokens or summary structure regex fails), SWT increments the counter. After **three consecutive failures**, SWT halts further model calls and prompts the user to either branch the session (`codex fork`), or restart with `codex resume <id>` from a known‑good checkpoint, or accept a coarser summary.

### E.5 Self‑healing memory pattern (MEMORY.md + topic files)

- **What it does:** Per public analyses, Claude Code's leaked architecture treats memory as a lightweight `MEMORY.md` index (always loaded, ≤ 200 lines, each entry being a one‑line pointer to a detailed topic file under `~/.claude/memory/topics/`). Memories are treated as unreliable and re‑validated on use.
- **Why it matters for SWT:** Long‑lived projects accumulate decisions, conventions, gotchas. Loading them all into every session is wasteful; the pointer pattern is exactly the right shape.
- **How to implement on Codex:** SWT writes `.swt/memory/MEMORY.md` (≤ 200 lines, line‑per‑pointer). The file is referenced from the project AGENTS.md so Codex sees it on every session. Topic files live under `.swt/memory/topics/<slug>.md` and are read on demand via either the file system tool or a dedicated `swt-memory-recall` skill. A SessionStart hook validates the index (no broken pointers, no stale topics older than `memory.staleness_days`).

### E.6 Structured handoff schemas

- **What it does:** Claude Code uses typed envelopes between agents (the leak shows several discriminated‑union schemas). VBW already does this with five JSON schemas (`scout_findings`, `dev_progress`, `dev_blocker`, `qa_result`, `debugger_report`).
- **Why it matters for SWT:** Free text between agents is lossy and inconsistent. Type‑checked envelopes are easier to validate in hooks and easier to render in the v1.5 dashboard.
- **How to implement on Codex:** SWT keeps VBW's five schemas, expressed in **Zod** under `packages/core/src/handoff/`. Each schema has a `schema_version` field and a forward‑compatible "extra fields are ignored" rule. Agents emit envelopes by writing JSON to a known stdout sentinel (e.g. `<<SWT_HANDOFF>>...<<END>>`) which the SWT CLI parses; PostToolUse hooks validate the envelope and reject malformed handoffs. Optional fallback to plain markdown when an agent fails to emit JSON, mirroring VBW's behaviour.

### E.7 Anti‑distillation patterns (advisory only)

- **What public analyses describe:** Claude Code reportedly injects decoy tool definitions ("fake_tools") behind a feature flag to make distillation against Claude Code's tool‑calling harder. SWT will **not** implement this — it adds complexity without clear user value and risks confusing the model.

---

## F. DEPENDENCIES

All versions are floors recommended at May 2026; the lockfile pins exact resolved versions.

### F.1 Runtime (production) dependencies

| Package | Min Version | Purpose |
|---|---|---|
| `@oclif/core` (or `commander`) | latest | CLI framework. Decision: **start with Commander for v1** for minimal surface area; reassess at v1.5 if plugin distribution argues for oclif. |
| `zod` | ^3.23 (or v4 stable when GA) | Schema validation for config and handoff envelopes |
| `@iarna/toml` or `smol-toml` | latest | TOML parsing for Codex config and SWT config |
| `execa` | ^9 | Spawning Codex CLI as subprocess |
| `consola` | ^3 | Structured logging with pretty output |
| `ora` | ^8 | Spinners / progress |
| `listr2` | ^8 | Task lists for multi-step CLI flows |
| `ink` (deferred to v1.5) | ^5 | Terminal UI for the dashboard; v1 stays line-oriented |
| `chalk` | ^5 | Colour output |
| `prompts` | ^2 (or `@inquirer/prompts`) | Interactive Q&A for `swt init` |
| `js-yaml` | latest | YAML frontmatter in PLAN.md |
| `gray-matter` | latest | Markdown + frontmatter parsing |
| `picomatch` | latest | Path globbing |
| `simple-git` | latest | Git operations (worktree create, commit, tag, push) |
| `globby` | ^14 | File discovery |
| `pkg-up` | latest | Locating project root |
| `proper-lockfile` | latest | Lease locks |
| `nanoid` | latest | Task / session IDs |
| `dayjs` | latest | Date math (memory staleness) |

### F.2 Dev dependencies

| Package | Purpose |
|---|---|
| `typescript` (^5.7+) | Language |
| `tsup` | Build to ESM + CJS dual output |
| `@types/node` | Types |
| `vitest` | Test framework |
| `@vitest/coverage-v8` | Coverage |
| `eslint` (flat config) | Linter |
| `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | TS linting |
| `prettier` | Formatter |
| `@changesets/cli` | Versioning + changelog (chosen over semantic-release for monorepo support) |
| `@changesets/changelog-github` | GitHub-aware changelog |
| `pnpm` | Package manager |
| `husky` | Git hooks |
| `lint-staged` | Pre-commit linting |
| `tsx` | Fast dev runner |

### F.3 External tool dependencies (must be installed on user machine)

| Tool | Why | Required / Optional |
|---|---|---|
| Node.js ≥ 20 LTS | Runtime | Required |
| `@openai/codex` (Codex CLI ≥ 0.124.0, the version where the v0.124.0 release notes confirm "Hooks are now stable, can be configured inline in config.toml and managed requirements.toml, and can observe MCP tools as well as apply_patch and long-running Bash sessions.") | The v1 backend | Required |
| `git` ≥ 2.40 | Worktrees, commits | Required |
| `gh` (GitHub CLI) | `swt release`, PR creation | Optional (recommended) |
| `jq` | Optional helper for JSON inspection | Optional |
| `tmux` | For team‑mode parallel Dev fan‑out | Optional |
| Bun | Documented as "supported but not recommended for v1" | Optional |

### F.4 Optional integration dependencies

- `openai/skills` repo (curated/experimental skill installer) — referenced by `swt skills`.
- `skills.sh` — community skill registry, queried by `swt skills --search`.
- MCP servers the user already runs (filesystem, git, GitHub) — auto‑detected and reported by `swt doctor`.

### F.5 Documentation dependencies

- **Mintlify** as primary docs platform.
- **Docusaurus** as backup option.
- `mermaid` for diagrams.
- `vale` for prose linting.

### F.6 CI/CD dependencies

- GitHub Actions: Node setup, pnpm setup, typecheck, test, lint, changeset check, publish
- `changesets/action` for the Version Packages PR
- `actions/setup-node`, `pnpm/action-setup`
- A `release` workflow gated on changesets and a green test matrix (Node 20, 22 on Ubuntu, macOS, Windows)
- `actions/cache` for pnpm cache
- Optional: Semgrep or CodeQL on every PR

---

## G. STEP‑BY‑STEP CHECKLIST

**Complexity tags:** S = small (afternoon), M = medium (a day or two), L = large (week+), XL = extra‑large (multi‑week).

### Phase 0 — Repo & org setup

**Goal.** Stand up `swt-labs` org and `stop-wasting-tokens` repo with branding, license, and minimum viable README.

**Acceptance criteria.** A public repo exists with a clear README, MIT licence, code of conduct, contributing guide, and a registered npm scope.

- [ ] Create `swt-labs` GitHub organisation under yidakee's account (S)
- [ ] Add Tiago as owner, set org email and avatar (S)
- [ ] Decide on org‑wide branch protection defaults (S)
- [ ] Create `stop-wasting-tokens` public repo under `swt-labs` (S)
- [ ] Add MIT LICENSE file (S)
- [ ] Add `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) (S)
- [ ] Add `CONTRIBUTING.md` with PR/issue conventions (M)
- [ ] Add `SECURITY.md` (responsible disclosure) (S)
- [ ] Reserve npm package name `stop-wasting-tokens` and `@swt-labs/cli` (S)
- [ ] Reserve domain (e.g. `stopwastingtokens.dev`) (S)
- [ ] Draft a brand voice guide (the British/Lisbon‑friendly tone), commit as `docs/brand.md` (M)
- [ ] Create initial `README.md` with TL;DR, install plan, and "this is alpha — see ROADMAP" callout (M)
- [ ] Create `.github/ISSUE_TEMPLATE/` (bug, feature, question) (S)
- [ ] Create `.github/PULL_REQUEST_TEMPLATE.md` (S)
- [ ] Set repo topics: `cli`, `codex`, `methodology`, `agents`, `vibe-coding` (S)
- [ ] Sunset announcement on VBW repo: pin issue, README banner, release v1.0.97‑sunset note (M)

### Phase 1 — Foundation

**Goal.** TypeScript monorepo, build tooling, CI/CD scaffolding, package layout.

**Acceptance criteria.** `pnpm install && pnpm build && pnpm test` passes from a fresh clone on Node 20 and 22, on Linux/macOS/Windows.

- [ ] Initialise pnpm workspace (`pnpm-workspace.yaml`) (S)
- [ ] Create `tsconfig.base.json` (strict, NodeNext, ES2022 target) (S)
- [ ] Create per‑package `tsconfig.json` extending the base (S)
- [ ] Configure `tsup` for ESM+CJS dual builds (M)
- [ ] Add `eslint.config.mjs` with `@typescript-eslint` and `eslint-plugin-import` (M)
- [ ] Add `.prettierrc` and decide on print width (100) (S)
- [ ] Wire `husky` pre‑commit + `lint-staged` (S)
- [ ] Set up Vitest with coverage thresholds (start at 60 %, raise to 80 % by Phase 7) (M)
- [ ] Initialise Changesets (`pnpm changeset init`) (S)
- [ ] Author `.github/workflows/ci.yml` (typecheck, test, lint matrix Node 20/22 × Linux/macOS/Windows) (M)
- [ ] Author `.github/workflows/release.yml` (Changesets Version Packages PR + npm publish on merge) (M)
- [ ] Author `.github/workflows/codeql.yml` (or Semgrep) (S)
- [ ] Configure repository secrets (`NPM_TOKEN`, optional `GH_TOKEN`) (S)
- [ ] Create the initial workspace package skeletons (M)
- [ ] Author root `package.json` with workspace scripts (S)
- [ ] Add `engines.node` to ≥ 20.18 (S)
- [ ] Decide on package strategy: single `stop-wasting-tokens` published, internal packages private (S)
- [ ] Add `.npmignore` / `package.json#files` (S)
- [ ] Smoke test the publish flow with `pnpm publish --dry-run` (S)
- [ ] Add `renovate.json` or Dependabot config (S)

### Phase 2 — Core abstractions

**Goal.** Define and document the four backend‑agnostic interfaces.

**Acceptance criteria.** `packages/core` exports typed interfaces for HookHost, AgentSpawner, PermissionGate, MemoryStore, plus the structured handoff Zod schemas. Unit tests cover the type contracts using mock implementations.

- [ ] Author `packages/core/src/types/effort.ts`, `autonomy.ts`, `verification.ts` (M)
- [ ] Author `packages/core/src/handoff/` with the five Zod schemas plus a generic `handoff_envelope` wrapper (M)
- [ ] Author `packages/core/src/abstractions/HookHost.ts` interface (M)
- [ ] Author `packages/core/src/abstractions/AgentSpawner.ts` interface (M)
- [ ] Author `packages/core/src/abstractions/PermissionGate.ts` interface (M)
- [ ] Author `packages/core/src/abstractions/MemoryStore.ts` interface (M)
- [ ] Author `packages/core/src/config/Config.ts` (Zod schema) (M)
- [ ] Author `packages/core/src/errors/` (typed error hierarchy) (M)
- [ ] Write a mock backend driver used by unit tests (M)
- [ ] Vitest tests for: schema parse/validate, profile preset resolution, error formatting (M)
- [ ] Document each abstraction in `docs/concepts/abstractions.md` with a "future Claude Code mapping" appendix (M)

### Phase 3 — Codex backend driver

**Goal.** A working `packages/codex-driver`.

**Acceptance criteria.** Given a config, the driver can: emit the 6 agent TOMLs; write a valid `~/.codex/hooks.json` or project `.codex/hooks.json`; launch `codex exec` with the correct sandbox and approval flags; parse `--json` output stream; install/remove SWT skills under `~/.codex/skills/`.

- [ ] Implement TOML emitter for `[agents.<role>]` block + per‑role TOML files (M)
- [ ] Implement AGENTS.md block writer (with `<!-- SWT BEGIN -->`/`<!-- SWT END -->` fences) (M)
- [ ] Implement `project_doc_max_bytes` size guard (warn if SWT block + user content exceed 32 KiB on any path) (S)
- [ ] Implement `hooks.json` emitter for the six survivable Codex events (M)
- [ ] Implement skill installer (M)
- [ ] Implement custom prompt installer (S)
- [ ] Implement Codex spawn wrapper using `execa` with `--json`, `--cd`, `--sandbox`, `--ask-for-approval`, `--profile` (L)
- [ ] Implement structured stdout parsing for handoff envelopes (M)
- [ ] Implement `codex resume` integration (M)
- [ ] Implement permission profile writer (M)
- [ ] Implement `[agents]` global config writer (`max_threads`, `max_depth`, role declarations) (S)
- [ ] Implement `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json` generators (M)
- [ ] Implement Codex feature‑flag toggles via `[features]` (S)
- [ ] Implement Codex version detection via `codex --version` and gate features behind minimum versions (M)
- [ ] Tests: unit‑level for each emitter; integration tests using a real Codex CLI behind a feature flag in CI (L)
- [ ] Document driver capabilities and known gaps in `docs/reference/codex-driver.md`, citing openai/codex#16732, #18491, #19385, #4311 (M)

### Phase 4 — Methodology authoring

**Goal.** Author the six agents (TOML + behavioural specs), the SWT skills, and the cache‑aware prompt builder.

**Acceptance criteria.** All six agents spawn correctly under `agents.max_threads = 6`, each skill auto‑matches an obvious user prompt, and the prompt builder produces a stable static prefix across sessions for a given config.

- [ ] Author `agents-templates/scout.toml` (M)
- [ ] Author `agents-templates/architect.toml` (M)
- [ ] Author `agents-templates/lead.toml` (M)
- [ ] Author `agents-templates/dev.toml` (M)
- [ ] Author `agents-templates/qa.toml` (M)
- [ ] Author `agents-templates/debugger.toml` with `xhigh` reasoning effort guidance (M)
- [ ] Author the six skills under `skills/` (L)
- [ ] Implement the cache‑aware prompt builder (M)
- [ ] Implement static‑layer hash check (S)
- [ ] Implement the methodology runtime: how Lead consumes Scout's output, how Dev fan‑out is gated by waves, how QA receives Dev's SUMMARY (L)
- [ ] Implement memory model (`MEMORY.md` + topic files) (M)
- [ ] Implement effort‑profile and autonomy‑profile resolution (M)
- [ ] Author the methodology guide in `docs/concepts/methodology.md` (L)
- [ ] Write end‑to‑end tests against the mock Codex driver (L)

### Phase 5 — Commands

**Goal.** All `swt` CLI commands implemented and documented.

- [ ] `swt init` (L)
- [ ] `swt vibe [phase]` (M)
- [ ] `swt plan [phase]` (M)
- [ ] `swt execute [phase]` (M)
- [ ] `swt qa [phase] [--tier quick|standard|deep]` (M)
- [ ] `swt status [--metrics] [--statusline]` (M)
- [ ] `swt config <get|set|profile|effort|autonomy|verification>` (M)
- [ ] `swt doctor` (M)
- [ ] `swt map [--scopes tech,arch,quality,concerns]` (M)
- [ ] `swt debug [--parallel-hypotheses N]` (M)
- [ ] `swt fix` (S)
- [ ] `swt archive` (S)
- [ ] `swt release [--dry-run --no-push --major --minor]` (M)
- [ ] `swt resume` (S)
- [ ] `swt pause` (S)
- [ ] `swt audit` (M)
- [ ] `swt assumptions` (S)
- [ ] `swt research` (S)
- [ ] `swt discuss` (S)
- [ ] `swt phase <add|insert|remove>` (M)
- [ ] `swt todo` (S)
- [ ] `swt skills [--search <q>]` (M)
- [ ] `swt whats-new` (S)
- [ ] `swt update` (S)
- [ ] `swt uninstall` (S)
- [ ] `swt help` (S)
- [ ] `swt worktree <create|list|merge|cleanup>` (S)
- [ ] `swt lease <acquire|release|status>` (S)

### Phase 6 — Artifacts engine

**Goal.** Reliable PROJECT/REQUIREMENTS/ROADMAP/STATE pipeline and per‑phase PLAN/SUMMARY/VERIFICATION generation.

**Acceptance criteria.** Round‑trip: SWT writes artefacts, an external editor edits them, SWT re‑reads without losing data; YAML frontmatter validates against schema.

- [ ] Define Zod schemas for each artefact type (M)
- [ ] Implement Markdown + YAML frontmatter writer/reader using `gray-matter` (M)
- [ ] Implement template engine (Handlebars or Eta) for artefact templates under `templates/` (M)
- [ ] Implement `STATE.md` updater with concurrency safety (M)
- [ ] Implement `ROADMAP.md` editor that supports `phase add/insert/remove` operations (M)
- [ ] Implement `phases/<n>/` directory layout writer (M)
- [ ] Implement `milestones/` archive on `swt archive` (M)
- [ ] Implement traceability links (REQUIREMENTS ↔ ROADMAP ↔ PLAN ↔ SUMMARY ↔ VERIFICATION) (L)
- [ ] Implement `.swt-planning/` git‑tracking advisor (S)
- [ ] Tests: golden‑file tests for templates; round‑trip tests for parser/writer (M)
- [ ] Document artefact taxonomy in `docs/reference/artefacts.md` (M)

### Phase 7 — Verification & QA

**Goal.** Continuous QA via hooks during builds, deep verification on demand via `swt qa`, goal‑backward methodology.

- [ ] Implement PostToolUse hook for SUMMARY.md structure validation (M)
- [ ] Implement PostToolUse hook for commit message format (Conventional Commits) (M)
- [ ] Implement PostToolUse hook for frontmatter description validation (S)
- [ ] Implement PreToolUse hook with bash‑guard (compound‑command parsing, denylist) (L)
- [ ] Implement PreToolUse hook with file‑guard (M)
- [ ] Implement PreToolUse hook with security‑filter (M)
- [ ] Implement SessionStart hook with state detection + map staleness check (M)
- [ ] Implement SessionStart "post‑compact" handler (M)
- [ ] Implement UserPromptSubmit hook with pre‑flight prompt validation (S)
- [ ] Implement Stop hook with session metrics logging (S)
- [ ] Implement compaction circuit breaker (3‑failure rule) (M)
- [ ] Implement `swt qa` runner with three tiers (quick/standard/deep) (L)
- [ ] Author the goal‑backward methodology spec (`docs/concepts/goal-backward.md`) (M)
- [ ] Implement requirement‑to‑task traceability checker (M)
- [ ] Tests: synthetic scenarios for each hook (M overall)

### Phase 8 — Documentation site

**Goal.** A docs site at `docs.stopwastingtokens.dev`.

- [ ] Choose Mintlify and stand up the site (M)
- [ ] Author `getting-started/install.md` (M)
- [ ] Author `getting-started/first-phase.md` (L)
- [ ] Author `concepts/methodology-layer.md` (M)
- [ ] Author `concepts/four-abstractions.md` (M)
- [ ] Author `concepts/effort-autonomy-verification.md` (M)
- [ ] Author `concepts/agents-and-roles.md` (M)
- [ ] Author `concepts/cache-aware-prompts.md` (M)
- [ ] Author `concepts/memory-model.md` (M)
- [ ] Author `concepts/handoff-schemas.md` (M)
- [ ] Author `reference/commands.md` for every `swt` verb (L)
- [ ] Author `reference/config-keys.md` (L)
- [ ] Author `reference/hooks.md` (event taxonomy and Codex gaps) (M)
- [ ] Author `reference/codex-driver.md` (M)
- [ ] Author `recipes/monorepos.md` (S)
- [ ] Author `recipes/cost-control.md` (M)
- [ ] Author `recipes/debugging.md` (M)
- [ ] Author `recipes/migrating-from-vbw.md` (L)
- [ ] Author `roadmap.md` (v1.5 plans, multi‑backend) (M)
- [ ] Wire docs deploys to GitHub Pages or Mintlify hosting (S)
- [ ] Add `vale` prose linting in CI (S)

### Phase 9 — Distribution

**Goal.** Reliable npm publishing, semantic versioning, automated changelog, install scripts, plugin marketplace listing.

- [ ] Configure Changesets in CI (Version Packages PR) (M)
- [ ] Decide single‑package vs multi‑package publishing strategy (decision: **single package** for v1; revisit at v1.5) (S)
- [ ] Implement `bin` entry in `package.json` pointing to compiled CLI (S)
- [ ] Add post‑install script (no auto‑edit of `~/.codex/`) (S)
- [ ] Implement `swt update` that calls `npm i -g` under the hood (S)
- [ ] Author `.codex-plugin/plugin.json` for marketplace listing (M)
- [ ] Submit SWT to the Codex Plugin Marketplace (S)
- [ ] Set up `provenance: true` for npm publish (S)
- [ ] Tag and ship v0.1.0 alpha (S)
- [ ] Verify Windows‑native install path (M)

### Phase 10 — Beta & feedback

**Goal.** Closed‑beta channel, working feedback loop, telemetry opt‑in.

- [ ] Stand up Discord server (S)
- [ ] Author server roles, channel taxonomy, code‑of‑conduct (S)
- [ ] Onboard initial 10 beta users from VBW community (M)
- [ ] Implement opt‑in telemetry (`swt config telemetry on`) (M)
- [ ] Set up a hosted endpoint or use a privacy‑respecting service (M)
- [ ] Author `BETA.md` describing what to test and how to report (S)
- [ ] Run a "vibe debugger" public stream demonstrating SWT (M)
- [ ] Iterate on UX based on top‑10 friction reports (XL)

### Phase 11 — v1.0 launch

- [ ] Final security review (M)
- [ ] Final docs sweep (M)
- [ ] Author `RELEASE-NOTES-v1.0.md` (S)
- [ ] Author launch blog post (M)
- [ ] Record a 5–8 minute demo video (M)
- [ ] HN post draft (S)
- [ ] r/programming, r/LocalLLaMA, r/ChatGPTCoding posts (S)
- [ ] Tweet/Bluesky/Mastodon thread (S)
- [ ] Update VBW README to point to SWT and mark VBW deprecated (S)
- [ ] Tag VBW v1.0.97‑final and archive the repo (S)

### Phase 12 — Forward‑compatibility prep for v1.5

- [ ] Audit core abstractions for Codex‑specific leakage (M)
- [ ] Author `packages/claude-code-driver/README.md` documenting the planned mapping (M)
- [ ] Stub Claude Code HookHost (12 events) with `Not implemented` errors (M)
- [ ] Stub Claude Code AgentSpawner (Fork/Teammate/Worktree) (M)
- [ ] Stub Claude Code PermissionGate (M)
- [ ] Stub Claude Code MemoryStore (CLAUDE.md, .claude/) (S)
- [ ] Author `docs/roadmap/v1.5.md` (M)
- [ ] Add UI/dashboard design notes (Ink TUI vs web) (M)

---

## H. RISK REGISTER

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Codex slash command auto‑invocation never lands** (Issue #4311) | High | Medium | Skills + AGENTS.md + custom prompts strategy is already SWT's primary path; `/swt:*` slash commands explicitly framed as transitional. |
| **PreToolUse `apply_patch` and MCP coverage stays incomplete** on older Codex versions (#16732, #18491) | Medium | High | SWT does not rely on PreToolUse alone for file safety. Pin minimum Codex CLI version to ≥ 0.124.0 where v0.124.0 release notes confirm hooks "can observe MCP tools as well as apply_patch and long-running Bash sessions." `swt file-guard` runs server‑side via the SWT‑managed apply_patch wrapper plus AGENTS.md prose guardrails plus Codex `[permissions]` writable_roots. |
| **PreToolUse `additionalContext` injection unsupported** (#19385) | High | Medium | SWT injects context via SessionStart and UserPromptSubmit only; PreToolUse is used only for blocking. |
| **`agents.max_threads` cap of 6 limits parallelism** | Medium | Medium | SWT's effort profiles default Dev fan‑out to ≤ 4 to leave headroom. For very large refactors, SWT switches to worktree mode + serial waves rather than maxing threads. |
| **Codex API breaking changes (TOML schema, hook events)** | Medium | High | Pin `codex` minimum version per SWT release; `swt doctor` reports Codex version and warns if known‑incompatible; CI matrix tests against current and one‑prior Codex. |
| **Token cost explosion at xhigh effort + GPT‑5.5 Pro** | Medium | High | The "balanced" profile is the documented default. xhigh + Pro is gated behind explicit `effort = "thorough"` *and* explicit profile opt‑in. |
| **Methodology drift during VBW→SWT transition** | High | Medium | Provide `recipes/migrating-from-vbw.md`; ship a `swt migrate-from-vbw` helper; pin VBW at its last version (v1.0.97) and label as deprecated. |
| **Legal exposure from Claude Code leak‑adjacent reimplementation** | Medium | High | Strict clean‑room rule. Contributors may read only secondary public analyses, never the leaked TypeScript. Every adopted pattern documented with the secondary source citation. SECURITY.md and CONTRIBUTING.md state the rule explicitly. SWT does not bundle, mirror, or distribute leaked code. Note: clean‑room legal status is genuinely unsettled (Phoenix v. IBM is sometimes cited as protective; other contexts mixed); SWT should not market itself as a "Claude Code clone". |
| **Skill auto‑invocation depends on description quality** | Medium | Medium | SWT's skill descriptions are ruthlessly trigger‑rich, version‑controlled, and tested with prompt eval suites in CI. |
| **Bun build path drifts on Windows** | Medium | Low | SWT does not require Bun. Node ≥ 20 LTS is the only supported runtime. |
| **Mintlify lock‑in or pricing change** | Low | Medium | Docs source is plain markdown; Docusaurus migration is pre‑validated. |
| **Subagent fan‑out cost worse than expected** | Medium | High | Worktree mode + careful `shared-prefix` prompt structuring; instrument cache hit rates from day one; "balanced" profile defaults conservative. |
| **Open issue #20616 blocks image‑generation hook coverage** | Low | Low | SWT v1 does not depend on image generation. |
| **OpenAI deprecates custom prompts entirely** | High | Low | SWT documents `~/.codex/prompts/swt/` as transitional; primary path is Skills. |

---

## I. SUCCESS METRICS

A v1 release is "worked" if all of the following hold three months after launch:

- **Quality.** ≥ 70 % of internal benchmark tasks pass `swt qa --tier deep` on the first build attempt; ≥ 90 % after one iteration.
- **Cost.** Median token cost per phase ≤ 1.3× a comparable raw `codex exec` baseline. The 30 % overhead is the planning + verification tax; if SWT charges more than that, the methodology isn't earning its keep.
- **Cache discipline.** Median static‑prefix cache hit rate ≥ 70 % across a 10‑turn session, measured by SWT's own instrumentation. (Anthropic's official prompt caching announcement at anthropic.com/news/prompt-caching reports up to 90% cost reduction and 85% latency reduction for long prompts as the upper bound.)
- **Time‑to‑first‑shipped‑phase.** A new user (with Codex installed and authenticated) ships their first SWT phase end‑to‑end in ≤ 90 minutes following only the docs.
- **Distribution.** ≥ 1 000 npm downloads in the first month; ≥ 500 GitHub stars in the first quarter. (For benchmarking ambition: per the ultraworkers/claw-code README, claw-code self-describes as "The fastest repo in history to surpass 100K stars" — sabrina.dev's leak analysis recorded it crossing 50,000 stars in two hours. SWT does not need to be that. ≥ 500 stars in a quarter for a non‑developer's first npm CLI is an honest target.)
- **Community.** ≥ 100 Discord members; ≥ 30 GitHub issues filed; ≥ 5 external contributors.
- **Subjective parity.** "Felt like Claude Code" parity score ≥ 7/10 in beta survey for users coming from VBW.
- **Stability.** ≤ 5 P0 issues open at any time after v1.0; mean time to fix ≤ 7 days.
- **Forward compatibility.** Stub Claude Code driver compiles and the abstractions audit (Phase 12) finds < 5 leakage points.

These are *targets*, not predictions. SWT is small, the market is competitive, and the user is a single non‑developer vibe coder; if the targets prove unrealistic, recalibrate openly in `docs/roadmap.md` rather than silently moving them.

---

## J. APPENDIX — REFERENCES & KEY READING

### J.1 Codex CLI primary documentation

- Codex Configuration Reference: `https://developers.openai.com/codex/config-reference`
- Codex Subagents: `https://developers.openai.com/codex/subagents`
- Codex AGENTS.md guide: `https://developers.openai.com/codex/guides/agents-md`
- Codex Hooks: `https://developers.openai.com/codex/hooks`
- Codex Skills: `https://developers.openai.com/codex/skills`
- Codex Custom Prompts (deprecated): `https://developers.openai.com/codex/custom-prompts`
- Codex Plugins: `https://developers.openai.com/codex/plugins`
- Codex Plugin Build: `https://developers.openai.com/codex/plugins/build`
- Codex Sandbox: `https://developers.openai.com/codex/concepts/sandboxing`
- Codex CLI Reference: `https://developers.openai.com/codex/cli/reference`
- Codex Slash Commands: `https://developers.openai.com/codex/cli/slash-commands`
- Codex Models: `https://developers.openai.com/codex/models`
- Codex Changelog: `https://developers.openai.com/codex/changelog`
- Codex Sample Configuration: `https://developers.openai.com/codex/config-sample`
- Codex v0.124.0 release notes (where the hooks-stable line appears): `https://github.com/openai/codex/releases/tag/rust-v0.124.0`
- OpenAI Help Center, Codex model release notes (gpt-5-codex-mini "up to 4x more usage"): `https://help.openai.com/en/articles/9624314`

### J.2 Codex CLI tracked issues that shape SWT design

- openai/codex#4311 — SlashCommand auto‑invocation
- openai/codex#16732 — `apply_patch` does not emit PreToolUse/PostToolUse on older versions
- openai/codex#18491 — extend PreToolUse beyond Bash + `updatedInput` rewrite
- openai/codex#19385 — `additionalContext` not supported in PreToolUse
- openai/codex#7138 — AGENTS.md silent truncation
- openai/codex#11817 — `/<skill>` not recognised, only `$<skill>`
- openai/codex#5419 — VS Code extension slash‑command parity
- openai/codex#3641 — Slash commands in `codex exec`
- openai/codex#20616 — image generation does not emit PreToolUse
- openai/codex#5983 — bypass/disable AGENTS.md pipeline

### J.3 Claude Code source‑leak secondary analyses (clean‑room source material)

- Sabrina, "Comprehensive Analysis of Claude Code Source Leak" (sabrina.dev)
- Kuber, "Claude Code's Entire Source Code Got Leaked via a Sourcemap in npm" (kuber.studio)
- ClaudeFast, "Claude Code Source Leak: Everything Found (2026)" (claudefa.st)
- Particula Tech, "Claude Code Source Leak: 7 Agent Architecture Lessons" (particula.tech)
- WaveSpeedAI, "Claude Code architecture Deep Dive" (wavespeed.ai)
- DigitalApplied, "Claude Code Leak: Agentic Architecture Lessons 2026"
- Tech Twitter, "The Breakdown of a Claude Code Prompt"
- Ken Huang, "Claude Code Pattern 7: Multi‑Agent Coordination"
- VentureBeat coverage of the 31 March 2026 disclosure
- layer5.io coverage
- Anthropic's official prompt caching announcement: `https://www.anthropic.com/news/prompt-caching`

### J.4 Reimplementations to learn from (read for *patterns*, not code)

- claw‑code (instructkr/claw‑code, ultraworkers/claw‑code) — Python + Rust clean‑room rewrite of Claude Code; per the ultraworkers/claw-code README, self-described as "The fastest repo in history to surpass 100K stars"; sabrina.dev's analysis records it surpassing 50,000 stars in two hours
- claurst (Kuberwastaken/claurst) — Rust clean‑room rewrite, contains exhaustive `spec/` documents
- nano‑claude‑code (shareAI‑lab) — minimal Python pedagogical rebuild
- ghuntley/claude‑code‑source‑code‑deobfuscation — flagged for *avoidance* (do not read)

### J.5 Methodology‑layer competitors

- VBW: `https://github.com/yidakee/vibe-better-with-claude-code-vbw`
- BMAD‑METHOD: `https://github.com/bmad-code-org/BMAD-METHOD`
- GitHub Spec Kit: `https://github.com/github/spec-kit`
- OpenSpec
- aider: `https://aider.chat`
- OpenCode: `https://opencode.ai`
- Continue.dev
- Cline, Roo Code (VS Code extensions)

### J.6 Codex orchestration layers (parallel projects)

- OMX (oh‑my‑codex by Yeachan‑Heo): `https://github.com/Yeachan-Heo/oh-my-codex` — closest in spirit to SWT, validates that the orchestration‑layer pattern works on Codex
- scalarian/oh‑my‑codex — different fork
- sigridjineth/oh‑my‑codex — Sigrid's personal Codex plugin

### J.7 Tooling references

- oclif: `https://oclif.io`
- Commander.js: `https://github.com/tj/commander.js`
- Changesets: `https://github.com/changesets/changesets`
- tsup: `https://tsup.egoist.dev`
- Vitest: `https://vitest.dev`
- Mintlify, Docusaurus
- Codex Plugin Marketplace: `https://www.codex-marketplace.com/`
- openai/skills: `https://github.com/openai/skills`
- skills.sh

### J.8 Open legal/ethical considerations

- Anthropic's DMCA enforcement against leak mirrors and the unsettled status of clean‑room reimplementation (Phoenix v. IBM cited as protective; other contexts mixed).
- Beankinney legal commentary, "512,000 Lines, One Night, Zero Permission" (2026).
- Anthropic's confirmation that the leak was "a release packaging issue caused by human error, not a security breach."

---

*End of plan. This document is the reference for SWT v1 and v1.5 work. No fixed deadline. No compromises. Stop wasting tokens.*