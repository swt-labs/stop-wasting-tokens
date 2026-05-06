# stop-wasting-tokens Requirements

Defined: 2026-05-05 | Core value: Token-disciplined, methodology-first SDLC for the Codex CLI.

## v1 Requirements

### Distribution & Runtime
- [ ] **REQ-01**: Distribute as a single Node/TypeScript CLI on npm (`npm i -g stop-wasting-tokens`); cross-platform with no Bash hard dependency.
- [ ] **REQ-16**: Type-safe configuration — Zod-validated TOML/JSON config loaded at startup.
- [ ] **REQ-17**: Build/release pipeline — pnpm workspaces, tsup ESM+CJS dual builds, Vitest, Changesets, GitHub Actions CI matrix (Node 20/22 × Linux/macOS/Windows), `provenance: true` on npm publish.

### Backend & Platform Integration
- [ ] **REQ-02**: Codex-first backend driver — emits TOML agents under `.codex/agents/`, writes `hooks.json`, installs Skills, manages AGENTS.md and custom prompts.
- [ ] **REQ-13**: Codex lifecycle hooks via `hooks.json` — SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop.
- [ ] **REQ-19**: Submit SWT to the Codex Plugin Marketplace via `.codex-plugin/plugin.json` once the npm path is solid.
- [x] **REQ-20**: v1.5 forward-compatibility — design-only stubs for Claude Code and Ollama drivers behind the same four core abstractions. (Phase 15 / PLAN 01 — `@swt-labs/claude-code-driver` and `@swt-labs/ollama-driver` shipped as stubs; abstractions audit at `.vbw-planning/research/v1-5-abstractions-audit.md`.)

### Methodology Layer
- [ ] **REQ-03**: Six methodology agents — Scout, Architect, Lead, Dev, QA, Debugger — each with its own model, reasoning effort, sandbox mode, and developer instructions.
- [ ] **REQ-04**: Four backend-agnostic core abstractions — HookHost, AgentSpawner, PermissionGate, MemoryStore.
- [ ] **REQ-05**: Cache-aware split prompts — stable static prefix layer, dynamic per-call layer, hash check for prefix stability.
- [ ] **REQ-07**: Zod-validated structured handoff envelopes for inter-agent communication.
- [ ] **REQ-08**: Effort, autonomy, and verification profile resolution per agent and per command.
- [ ] **REQ-11**: MEMORY.md self-healing memory model — ≤ 200-line always-on index plus topic files referenced by the index.

### Artefacts & Lifecycle
- [ ] **REQ-06**: `.swt-planning/` artefacts pipeline — PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, phases/<n>/PLAN.md and SUMMARY.md, milestones/.
- [ ] **REQ-09**: Goal-backward QA with three tiers — quick / standard / deep.
- [ ] **REQ-10**: Compaction circuit breaker (3-failure rule) to prevent runaway loops.
- [ ] **REQ-12**: Full `swt` CLI command surface — init, vibe, plan, execute, qa, status, config, doctor, map, debug, fix, archive, release, resume, pause, audit, assumptions, research, discuss, phase, todo, skills, whats-new, update, uninstall, help, worktree, lease.

### Security & Governance
- [ ] **REQ-14**: Permission gate — sandbox modes (read-only, workspace-write, danger-full-access), approval policies, named permission profiles, plus an SWT-side bash safety pre-filter (clean-room).
- [ ] **REQ-15**: Strict clean-room rule for any patterns inspired by the Claude Code source leak — reference only secondary public analyses, never the leaked source.

### Documentation
- [ ] **REQ-18**: Documentation site at `docs.stopwastingtokens.dev` (Mintlify or Docusaurus) covering getting-started, concepts, reference, recipes, and a v1.5 roadmap.

## v2 Requirements
- [ ] **REQ-V2-01**: UI/dashboard (Ink TUI vs web — design notes in Phase 12). (See `.vbw-planning/research/ui-dashboard-tradeoffs.md` for the v1.5 design notes; recommendation is Ink TUI first, web deferred to v2.)
- [ ] **REQ-V2-02**: Claude Code backend driver implementation (12-event hook taxonomy, Agent Teams, isolation modes).
- [ ] **REQ-V2-03**: Ollama / open-source backend driver implementation.

## Out of Scope (v1)
- Hosted SaaS / cloud orchestration
- IDE extensions (Codex CLI / Claude Code CLI cover the editor surface for now)
- Mirroring or distributing any portion of the Claude Code leaked source
- Marketing SWT as a "Claude Code clone"
