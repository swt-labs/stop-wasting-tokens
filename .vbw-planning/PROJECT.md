# stop-wasting-tokens

Codex-first, methodology-first reimagining of VBW — a Node/TypeScript CLI on npm bringing a six-agent SDLC and goal-backward verification to the OpenAI Codex CLI. v1 is Codex-only; v1.5 adds Claude Code and Ollama backend drivers behind the same four core abstractions.

**Core value:** Token-disciplined, methodology-first SDLC for the Codex CLI.

## Requirements

### Validated
_(none yet — see REQUIREMENTS.md for v1 scope)_

### Active
- [ ] REQ-01: Single Node/TypeScript CLI on npm; cross-platform, no Bash hard dependency
- [ ] REQ-02: Codex-first backend driver (TOML agents, hooks.json, Skills, AGENTS.md)
- [ ] REQ-03: Six methodology agents (Scout, Architect, Lead, Dev, QA, Debugger)
- [ ] REQ-04: Four core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore)
- [ ] REQ-05: Cache-aware split prompts with stable static prefix
- [ ] REQ-06: `.swt-planning/` artefacts pipeline (PROJECT, REQUIREMENTS, ROADMAP, STATE, phases/, milestones/)
- [ ] REQ-07: Zod-validated handoff envelopes for inter-agent communication
- [ ] REQ-08: Effort, autonomy, and verification profiles
- [ ] REQ-09: Goal-backward QA with three tiers (quick / standard / deep)
- [ ] REQ-10: Compaction circuit breakers (3-failure rule)
- [ ] REQ-11: MEMORY.md self-healing memory model (≤ 200-line index plus topic files)
- [ ] REQ-12: Full `swt` CLI command surface
- [ ] REQ-13: Codex lifecycle hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop)
- [ ] REQ-14: Permission gate (sandbox modes + approval policies + named profiles + clean-room bash pre-filter)
- [ ] REQ-15: Strict clean-room rule for Claude-Code-leak-adjacent patterns
- [ ] REQ-16: Zod-validated TOML/JSON config at startup
- [ ] REQ-17: Build/release pipeline (pnpm, tsup, Vitest, Changesets, GitHub Actions matrix, npm provenance)
- [ ] REQ-18: Documentation site at docs.stopwastingtokens.dev
- [ ] REQ-19: Codex Plugin Marketplace listing via `.codex-plugin/plugin.json`
- [ ] REQ-20: v1.5 forward-compatibility stubs for Claude Code and Ollama drivers

### Out of Scope (v1)
- UI/dashboard — deferred to v1.5
- Multi-backend driver implementations (Claude Code, Ollama) — deferred to v1.5; design-only stubs in Phase 12
- Hosted SaaS / cloud orchestration
- IDE extensions (relying on Codex/Claude Code CLI for now)

## Constraints
- **Codex-only in code until v1.5**: backend-agnostic in *positioning*, Codex-only in *implementation*
- **Clean-room**: contributors may read only secondary public analyses of the Claude Code source leak, never the leaked TypeScript itself
- **Cross-platform from day one**: Node/TypeScript, no Bash hard dependency; Windows works natively
- **Cache discipline**: every prompt has an intentional static/dynamic split; every plan exposes token cost
- **Codex CLI minimum**: pin to a known-good version (e.g. ≥ 0.124.0) to ensure stable hook coverage

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Codex-first, single-backend in code | Avoid spreading thin across runtimes before methodology is proven | v1 ships Codex-only; v1.5 introduces multi-backend drivers |
| Methodology delivered via Skills + AGENTS.md (not slash commands) | Codex doesn't auto-invoke custom slash commands (openai/codex#4311) | `/swt:*` shipped as transitional ergonomic only |
| Hard sunset of VBW | Avoid maintaining two methodology codebases | VBW pinned at v1.0.97; README points to SWT |
| Strict clean-room rule for leak-inspired patterns | Avoid legal exposure | Every adopted pattern documented with a secondary-source citation |
