# stop-wasting-tokens — v1.5.1 Codex SDK conformance

**Milestone goal:** Resolve the 17 findings from the Codex SDK verification research (`.vbw-planning/research/20260507-081032-verify-codex-sdk-best-practices.md`) so SWT v1.5 aligns with documented Codex SDK behavior at `developers.openai.com/codex`. Tier 4 findings (F-05 `allowed_mcp_servers`, F-06 `max_turns`, F-07 `role` aliasing, F-12 expanded HookSubBlockSchema, F-15 AGENTS.override.md migration, F-17 cache-hit measurement test) are intentionally deferred to v1.6+.

## Phase List
- [x] [Phase 1: SDK Critical Conformance](#phase-1-sdk-critical-conformance)
- [x] [Phase 2: Plugin Marketplace Prep](#phase-2-plugin-marketplace-prep)
- [x] [Phase 3: Hook Integration & Drift Cleanup](#phase-3-hook-integration--drift-cleanup)

## Progress
| Phase | Status | Plans | Tasks | Commits |
|-------|--------|-------|-------|---------|
| 01 | ● Done | 1 | 5 | 4 |
| 02 | ● Done | 1 | 3 | 2 |
| 03 | ● Done | 1 | 5 | 4 |

---

## Phase 1: SDK Critical Conformance

**Goal:** Make SWT's 6 agent profile TOMLs loadable by a real Codex CLI by replacing rejected values with documented Codex schema values, and adding the required `name` and `description` fields.

**Requirements:** REQ-02 (Codex-first backend), REQ-03 (six methodology agents)

**Success criteria:**
- All 6 agent TOMLs (`packages/methodology/templates/agents/{scout,architect,lead,dev,qa,debugger}.toml`) declare `model` ∈ Codex catalog (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`).
- All 6 agent TOMLs declare `model_reasoning_effort` ∈ enum `{minimal, low, medium, high, xhigh}`.
- All 6 agent TOMLs declare `name` (string) and `description` (human-facing guidance).
- The codex-plugin-manifest test (or a new agent-toml-validity test) asserts the model and reasoning-effort values are members of the documented Codex enums — drift detection.

**Findings remediated:**
- F-01 (CRITICAL): `model = "gpt-5-codex"` → `model = "gpt-5.3-codex"` (or `gpt-5.5` per role)
- F-02 (CRITICAL): `model_reasoning_effort = "balanced"` → enum-valid value per role
- F-04 (HIGH): add `name` + `description` to all 6 templates

---

## Phase 2: Plugin Marketplace Prep

**Goal:** Make SWT discoverable + installable via the Codex Plugin Marketplace by moving the manifest to the documented path, restructuring fields to match the published schema, and synchronizing version with the npm package.

**Requirements:** REQ-19 (Codex Plugin Marketplace listing)

**Success criteria:**
- Plugin manifest lives at `.codex-plugin/plugin.json` (repo root) per Codex docs.
- Manifest fields match documented schema: `keywords` (not `tags`), `interface` block (`displayName`, `category`, `screenshots`), `author` as object `{name, url}` (not bare string), drop undocumented top-level `install` and `commands` fields.
- Manifest `version` syncs from the workspace's npm package version (no longer pinned at `0.0.0`).
- A build-time test asserts `.codex-plugin/plugin.json:version === package.json:version`.

**Findings remediated:**
- F-03 (HIGH): manifest path `packages/cli/codex-plugin.json` → `.codex-plugin/plugin.json`
- F-13 (MEDIUM): manifest schema realignment (tags→keywords, flat→interface, author string→object, drop install/commands)
- F-14 (LOW): version sync with npm package version (build-time codegen)

---

## Phase 3: Hook Integration & Drift Cleanup

**Goal:** Wire the codex-driver's hooks emit path so SWT's HookHost taxonomy correctly translates to Codex's `hooks.json` schema. Cleans up doc/comment drift in the agent TOML headers.

**Requirements:** REQ-13 (Codex lifecycle hooks)

**Success criteria:**
- The codex-driver's hooks-writer filters HookEvent → only the 6 v1.0 generic events when emitting to Codex (the 6 v1.5 SDLC events are SWT-internal and never reach Codex's `hooks.json`).
- The hooks-writer translates SWT snake_case event names → Codex PascalCase (`session_start` → `SessionStart`, `pre_tool_use` → `PreToolUse`, etc.).
- The hooks-writer emits `[features] codex_hooks = true` in the user's `~/.codex/config.toml` (or warns if not present).
- Each translation step has a unit test in `packages/codex-driver/test/hooks/`.
- The 6 agent TOML header comments reference `~/.codex/config.toml [mcp_servers.X]` (the actual Codex MCP path) instead of the wrong `~/.codex/mcp.json`.

**Findings remediated:**
- F-08 (MEDIUM): TOML header comment cites wrong MCP config path
- F-09 (MEDIUM): codex-driver must filter SDLC events when emitting to Codex
- F-10 (MEDIUM): snake_case → PascalCase translation when emitting hook event names
- F-11 (MEDIUM): emit `[features] codex_hooks = true` to enable hooks in Codex

---

## Out of Scope (deferred to v1.6+)

- F-05 (HIGH): `allowed_mcp_servers` field — drop or SWT-namespace; deferred pending decision on per-role MCP scoping abstraction
- F-06 (HIGH): `max_turns` field — move to ConfigSchema only or SWT-namespace in TOML
- F-07 (MEDIUM): `role` field — SWT-internal alias for Codex `name`; rename or drop after Phase 1 lands `name`
- F-12 (MEDIUM): expand `HookSubBlockSchema` to mirror Codex's full nested schema (matchers, multiple hooks per event, statusMessage, timeout)
- F-15 (LOW): consider migrating SWT-managed AGENTS.md content from `<!-- SWT BEGIN/END -->` fences → `~/.codex/AGENTS.override.md` per Codex idiom
- F-17 (LOW): add an end-to-end `cached_tokens` measurement test for REQ-05 cache discipline
