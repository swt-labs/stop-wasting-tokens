# stop-wasting-tokens Roadmap

**Goal:** Ship v1.5 — close the v1.0 audit findings, replace stub drivers with real implementations, and round out the user-facing surfaces and methodology infrastructure.

**Scope:** 5 phases. Phase 1 absorbs the v1.0 launch audit (5 criticals + 4 majors) into a single hardening pass; Phases 2-5 deliver the 8 stable Fn features from `docs/roadmap/v1.5.md` (F1-F8), grouped by domain coupling rather than 1-Fn-per-phase.

## Progress
| Phase | Status | Plans | Tasks | Commits |
|-------|--------|-------|-------|---------|
| 01 | ● Done |
| 02 | ● Done |
| 03 | ○ Planned |
| 04 | ○ Pending | | | |
| 05 | ○ Pending | | | |

---

## Phase List
- [x] [Phase 1: v1.0 launch hardening](#phase-1-v10-launch-hardening)
- [x] [Phase 2: F1 — Real Codex AgentSpawner wiring](#phase-2-f1--real-codex-agentspawner-wiring)
- [ ] [Phase 3: F2 + F3 — Multi-backend drivers](#phase-3-f2--f3--multi-backend-drivers)
- [ ] [Phase 4: F4 + F5 + F8 — User-facing surfaces](#phase-4-f4--f5--f8--user-facing-surfaces)
- [ ] [Phase 5: F6 + F7 — Methodology infrastructure](#phase-5-f6--f7--methodology-infrastructure)

---

## Phase 1: v1.0 launch hardening

**Goal:** Close all v1.0 audit findings so SWT is genuinely Codex-compliant and free of leftover VBW identifiers in product code. This is the launch-blocking trio (C1-C5) plus the smaller M-tier items that share file boundaries with the C-tier work.

**Requirements:** REQ-02, REQ-06, REQ-17, REQ-19

**Success Criteria:**
- `swt init` writes `AGENTS.md` (not `CLAUDE.md`) when the active backend is `codex` — wires `bootstrap.ts` to `packages/codex-driver/src/agents-md/writer.ts` (C1)
- `packages/artifacts/src/bootstrap/claude.ts` constants renamed: `VBW_OWNED_SECTIONS` → `SWT_OWNED_SECTIONS`, `VBW_RULES_BLOCK` → `SWT_RULES_BLOCK`, `## VBW Rules` heading → `## SWT Rules`. Migration logic recognises legacy `VBW Rules` headings and rewrites them on read (C2)
- All 6 `agents-templates/*.toml` files swap fictional `model = "gpt-5.5-pro"` for a real Codex-supported model identifier (or empty/`default` to defer to user profile) (C3)
- `packages/cli/codex-plugin.json` `$schema` field replaced with the real OpenAI Codex Plugin Marketplace schema URL (or removed if optional) (C4)
- `packages/cli/src/commands/stubs.ts:20` references `.swt-planning/ROADMAP.md`, not `.vbw-planning/` (C5)
- `README.md:3` no longer points at `.vbw-planning/ROADMAP.md` (M1)
- `scripts/verify-install.sh` removes the `.vbw-planning/` fallback in the post-install smoke test (M3)
- `agents-templates/*.toml` `allowed_mcp_servers` use real MCP server identifiers or are documented as illustrative placeholders (M6)
- `verify-state-consistency.sh --mode archive` no longer flags `missing_roadmap_md` as a hard FAIL when the project is in clean post-archive state with no active milestone (M7)

**Dependencies:** None — all changes are local to product code.

---

## Phase 2: F1 — Real Codex AgentSpawner wiring

**Goal:** Replace the inline orchestrator stubs with a live `codex exec`-driven AgentSpawner so `swt vibe --execute` actually spawns Codex subagents end-to-end. Foundation for F2 and F3.

**Requirements:** REQ-02, REQ-04

**Success Criteria:**
- `@swt-labs/codex-driver` exposes a real AgentSpawner implementation that wraps `codex exec --json` and parses NDJSON handoff envelopes
- Live `swt vibe --execute` against a real project completes the full lifecycle without orchestrator-side fakes
- Mock driver retained for vitest hermetic runs (existing `test/mock-driver.ts` ScriptedPrompter pattern preserved)
- Per-role model resolution honored via `resolve-agent-settings`-equivalent path
- Token usage round-tripped via `SpawnResult.usage`
- Multi-driver orchestration deferred to v2 (out of scope per F1)

**Dependencies:** Phase 1 (Codex-correct manifest + AGENTS.md must land before live spawning is meaningful).

---

## Phase 3: F2 + F3 — Multi-backend drivers

**Goal:** Replace the v1.0 stubs in `@swt-labs/claude-code-driver` and `@swt-labs/ollama-driver` with real implementations sharing F1's interface. Bundled because both lift through the AgentSpawner / HookHost / PermissionGate abstractions and need lockstep interface validation.

**Requirements:** REQ-04, REQ-20

**Success Criteria:**
- Same `swt vibe` workflow runs against Claude Code as against Codex (F2)
- Hook event taxonomy in Claude Code driver covers the 12 events; SWT's 6 generic events map to a subset (F2)
- Agent Teams parallelism works the same as Codex teams — real `team_name` + per-teammate spawn (F2)
- Worktree isolation modes (off / hard / soft) honored (F2)
- `@swt-labs/ollama-driver` wraps a local Ollama instance; `swt vibe --execute` against a local model completes the lifecycle (F3)
- `model_overrides` config respected (F3)
- Sandbox modes degrade gracefully — driver wraps process-level isolation (F3)
- Hosted Ollama / Ollama Cloud out of scope (per F3)
- VBW Claude Code migration helper out of scope — already covered by Phase 11 migration guide (per F2)

**Dependencies:** Phase 2 (F1) — both drivers consume the AgentSpawner interface F1 stabilises.

---

## Phase 4: F4 + F5 + F8 — User-facing surfaces

**Goal:** Three independent user-facing additions that share no driver coupling: live TUI dashboard, marketplace-aware updater, and real telemetry HTTP sender. Bundled because each is small (S/M) and they touch distinct package surfaces.

**Requirements:** REQ-12, REQ-19, plus telemetry contract from `@swt-labs/telemetry`.

**Success Criteria:**
- `swt watch` opens an Ink TUI scoped to the active milestone, updates within 1s on file-system changes, closes cleanly on Ctrl+C, cross-platform (Linux/macOS/Windows terminals) (F4)
- `swt update` queries the Codex Plugin Marketplace API alongside (or instead of) the npm registry; marketplace-listed version stays in lockstep with the npm-published version (F5)
- `@swt-labs/telemetry` `NoopSender` default replaced with a real HTTP sender behind `enabled: true` opt-in (F8)
- Configurable `telemetry.endpoint` config key (F8)
- Configurable `telemetry.cache_ttl_hours` config key (F8)
- Privacy contract from v1.0 docs preserved exactly — no PII, anonymous UUIDv4, sanitize-on-send (F8)

**Dependencies:** None — all three are independent of F1/F2/F3.

---

## Phase 5: F6 + F7 — Methodology infrastructure

**Goal:** Replace hand-authored reference docs with codegen and expand the hook event taxonomy. Both are methodology-internal and don't surface in user workflows directly.

**Requirements:** REQ-13, REQ-18

**Success Criteria:**
- `pnpm docs:gen` produces `docs/reference/cli.mdx`, `docs/reference/config.mdx`, `docs/reference/artifacts.mdx` from source (F6)
- Hand-authored "When to override" prose preserved as side-files merged into codegen output (F6)
- AUTO-DERIVE-CANDIDATE annotations removed from v1.0 docs once codegen is canonical (F6)
- Build-time check fails if a Zod schema gains a new key without docs coverage (F6)
- Six new hook events scaffolded: `pre_archive`, `post_phase`, `pre_phase`, `post_uat_fail`, `pre_qa`, `post_qa` (F7)
- Each new event has a documented config key + sample script (F7)
- Existing `post_archive` semantics unchanged (F7)
- HookHost narrowing helpers per the abstractions audit (`isPreToolUseEvent(ctx)` style) (F7)

**Dependencies:** None for scaffolding. F7's load-bearing implementations of new events depend on Phase 3 (F2 Claude Code driver) but the scaffolding can ship independently.
