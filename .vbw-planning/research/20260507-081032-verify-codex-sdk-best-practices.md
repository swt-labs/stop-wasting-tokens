---
title: Verify SWT v1.5 against official Codex SDK best practices
type: standalone-research
status: complete
confidence: high
created: 2026-05-07 08:10:32
updated: 2026-05-07 08:16:35
base_commit: d59cf50f7f4a3eb6505da470c3f96e1ffca1e8e3
linked_sessions: []
sources_consulted:
  - https://developers.openai.com/codex
  - https://developers.openai.com/codex/hooks
  - https://developers.openai.com/codex/config-reference
  - https://developers.openai.com/codex/config-advanced
  - https://developers.openai.com/codex/concepts/sandboxing
  - https://developers.openai.com/codex/plugins
  - https://developers.openai.com/codex/plugins/build
  - https://developers.openai.com/codex/mcp
  - https://developers.openai.com/codex/guides/agents-md
  - https://developers.openai.com/codex/subagents
  - https://developers.openai.com/codex/models
  - https://developers.openai.com/api/docs/guides/prompt-caching
---

# Research: Verify SWT v1.5 against official Codex SDK best practices

## Summary

Inline research pass cross-referencing the just-shipped v1.5 milestone against `developers.openai.com/codex`. Findings are ranked by impact on Codex integration. **Two CRITICAL issues** (invalid `model` identifier, invalid `model_reasoning_effort` enum value) will prevent any agent profile from spawning if loaded by a real Codex CLI today. **Three HIGH issues** affect discoverability/installability (plugin manifest path, missing required subagent fields, undocumented `allowed_mcp_servers` field). The remaining MEDIUM/LOW issues are schema drift, documentation/comment errors, and methodology-vs-runtime conceptual mixing that won't break Codex but should be cleaned up before submitting to the Codex Plugin Marketplace.

**Net assessment:** the methodology architecture is sound; the integration glue with Codex's actual file formats has drift from documented schemas in roughly 12 places. None require redesigning v1.5 — most are 1–10 line edits to TOML / JSON / comment text.

## Confidence

✓ HIGH for items grounded in `developers.openai.com/codex` page content fetched 2026-05-07. Direct quotes preserved where the documentation phrasing matters.

## Findings

Severity legend: 🔴 CRITICAL (Codex will reject) · 🟡 HIGH (Codex will not discover/install correctly) · 🟠 MEDIUM (silent drift, may work today but breaks future-Codex) · 🟢 LOW (cosmetic, comment-only).

---

### F-01 🔴 CRITICAL — `model = "gpt-5-codex"` is not a documented Codex model identifier

**Where:** All 6 SWT agent template files at `packages/methodology/templates/agents/{scout,architect,lead,dev,qa,debugger}.toml`.

**Current value:**
```toml
model = "gpt-5-codex"
```

**Codex docs say** (`/codex/models`):
> The documentation does **not** list any model called "gpt-5-codex"; the actual identifier is "gpt-5.3-codex".

**Documented model identifiers:**
- `gpt-5.5` (recommended default — newest frontier)
- `gpt-5.4` (flagship)
- `gpt-5.4-mini` (fast/cheap)
- `gpt-5.3-codex` (industry-leading coding model — likely the SWT intent)
- `gpt-5.3-codex-spark` (research preview, real-time iteration)
- `gpt-5.2` (previous gen)

**Audit-trail context:** Plan 01-02 DEV-2A recorded the choice as plan-amendment (chose `gpt-5-codex` over a `default` sentinel that wasn't documented). The post-Phase 01 R01 reconciliation noted: *"Phase 2 (F1 wiring) is the natural place to revisit if the model identifier proves wrong at runtime."* That moment is here — the identifier is wrong.

**Fix:** Replace `model = "gpt-5-codex"` → `model = "gpt-5.3-codex"` across all 6 templates. Or use `gpt-5.5` as the default since Codex docs say *"start with `gpt-5.5`"*. Both are real; SWT should pick deliberately.

---

### F-02 🔴 CRITICAL — `model_reasoning_effort = "balanced"` is not in Codex's enum

**Where:** All 6 SWT agent template TOMLs.

**Current value:**
```toml
model_reasoning_effort = "balanced"
```

**Codex docs say** (`/codex/config-reference`):
> `model_reasoning_effort` (enum): `minimal | low | medium | high | xhigh`

`"balanced"` is not a valid value — Codex will reject the config (or silently fall back to default).

**Fix:** Replace with `medium` (the natural map for "balanced" intent). Per-role differentiation could be:
- `scout = "low"` (read-only investigation)
- `architect = "high"` (design heavy)
- `lead = "medium"` (planning)
- `dev = "medium"` (implementation)
- `qa = "medium"` (verification)
- `debugger = "high"` (deep investigation)

---

### F-03 🟡 HIGH — Plugin manifest at wrong path

**Where:** `packages/cli/codex-plugin.json`.

**Codex docs say** (`/codex/plugins/build`):
> The manifest file is located at `.codex-plugin/plugin.json` within the plugin root directory.

**Issue:** SWT's manifest is at `packages/cli/codex-plugin.json` (flat, no `.codex-plugin/` directory). When a user runs `codex /plugins` → Install → and points at SWT, Codex won't find the manifest at the documented path. Same for `swt-labs/stop-wasting-tokens` repo discovery.

**Fix:** Move to one of:
- `.codex-plugin/plugin.json` (repo root) — for the npm-published plugin
- `packages/cli/.codex-plugin/plugin.json` (if SWT wants it scoped to the cli package)

The first option is simpler for users. The second matches monorepo convention but means Codex's `codex /plugins` discovery would have to traverse to find it (not documented behavior).

**Audit-trail context:** Plan 01-02 DEV-2B removed a placeholder `$schema` field — that was correct (no `$schema` is documented as required). Plan 01-02 didn't catch the path issue because the docs page wasn't fetched at the time.

---

### F-04 🟡 HIGH — Required Codex subagent fields `name` and `description` missing from SWT TOMLs

**Where:** All 6 SWT agent template TOMLs.

**Codex docs say** (`/codex/subagents`):
> **Required fields:**
> - `name` (string): "Agent name Codex uses when spawning or referring to this agent"
> - `description` (string): "Human-facing guidance for when Codex should use this agent"
> - `developer_instructions` (string): "Core instructions that define the agent's behavior"

SWT TOMLs only have `developer_instructions`. They use `role = "scout"` (etc.) but `role` is not the documented field — `name` is.

**Fix:** Add `name` and `description` to each TOML. Example for scout.toml:
```toml
name = "scout"
description = "Read-only research agent. Use when you need to gather domain context or investigate a codebase before planning."
developer_instructions = """..."""
```

`role` can stay as a SWT-internal alias for compatibility, but `name` is required for Codex spawn semantics.

---

### F-05 🟡 HIGH — `allowed_mcp_servers` is not a documented Codex field

**Where:** All 6 SWT agent template TOMLs.

**Current value:**
```toml
allowed_mcp_servers = ["filesystem", "web-fetch", "web-search"]
```

**Codex docs say** (`/codex/subagents`):
> `mcp_servers` (object) — MCP server configuration (inherits from parent if omitted).
> ...
> **`allowed_mcp_servers` field:** Not documented. The schema shows `mcp_servers` as the configuration field, with no whitelist mechanism mentioned.

The header comment SWT added (Plan 01-02 DEV-2C: *"illustrative identifiers — replace with the real MCP server names registered in your `~/.codex/mcp.json`"*) anticipated some of this, but the overall field name is wrong. Codex doesn't have a per-agent allow-list mechanism in the documented schema — agents inherit `mcp_servers` from the parent if omitted.

**Fix options:**
1. **Drop `allowed_mcp_servers` entirely.** Per-role MCP scoping is not a documented Codex feature; agents inherit from the parent's MCP configuration. The illustrative-placeholder pattern doesn't help if the field is unrecognized.
2. **Replace with a real `mcp_servers` block** (object form) listing named server configs — but those configs go in `~/.codex/config.toml [mcp_servers.X]`, not in agent profiles.
3. **Keep as a SWT-internal field** that the codex-driver translates to actual `~/.codex/config.toml` entries at install time. This is closest to the current intent, but the agent TOML field name should be SWT-namespaced (e.g. `swt_recommended_mcp_servers`) to avoid colliding with future Codex schema additions.

Option 1 is cleanest. Option 3 is the most ambitious but matches the "SWT manages everything for the user" thesis.

---

### F-06 🟡 HIGH — `max_turns` is not in Codex's subagent schema

**Where:** All 6 SWT agent template TOMLs.

**Current value:**
```toml
max_turns = 15  # (varies per role)
```

**Codex docs say** (`/codex/subagents`):
> **Turn-cap fields:** No `max_turns` or similar turn-limiting field exists in the schema. Parent-level settings include `agents.max_threads` and `agents.max_depth`, but not per-agent turn caps.

**Status:** SWT's `agent_max_turns` config (in ConfigSchema) is a SWT-internal concept. The agent-spec-resolver from Plan 02-03 uses it. But putting it in agent TOML files implies Codex respects it — Codex doesn't.

**Fix:** Either drop `max_turns` from the TOML files (move it to SWT's resolver-only domain in `config.json`) or rename to a SWT-namespaced field (e.g. `swt_max_turns`) so future Codex schemas don't collide.

---

### F-07 🟠 MEDIUM — `role` field is SWT-only (Codex uses `name`)

**Where:** All 6 SWT agent template TOMLs.

**Current value:**
```toml
role = "scout"
```

**Codex docs say** (`/codex/subagents`):
> The schema uses `name` as the primary identifier, not `role`.

**Status:** Same class as F-04. SWT's `role` is structurally identical to Codex's `name` — just renamed. Adding `name` (F-04) and either dropping `role` or treating it as an alias resolves this.

---

### F-08 🟠 MEDIUM — TOML header comment cites the wrong MCP config path

**Where:** All 6 SWT agent template TOMLs (header comment block, Plan 01-02 DEV-2C).

**Current text:**
> "replace with the real MCP server names registered in your `~/.codex/mcp.json` (or omit servers you don't have configured)."

**Codex docs say** (`/codex/mcp`):
> "Codex stores MCP configuration in `config.toml` alongside other Codex configuration settings."

The actual path is `~/.codex/config.toml` with `[mcp_servers.<server-name>]` blocks, NOT `~/.codex/mcp.json`. The `mcp.json` file format only appears INSIDE plugin manifests (referenced via `mcpServers: "./mcp.json"` in plugin.json), not at the user's `~/.codex/` level.

**Fix:** Update the header comment to reference `~/.codex/config.toml` and `[mcp_servers.X]` syntax, OR (per F-05) drop the `allowed_mcp_servers` block entirely and remove the comment.

---

### F-09 🟠 MEDIUM — 6 v1.5 SDLC hook events are not Codex hook events

**Where:** `packages/core/src/abstractions/HookHost.ts` — HookEvent union has 12 variants. The 6 v1.5 events (`pre_archive`, `post_phase`, `pre_phase`, `post_uat_fail`, `pre_qa`, `post_qa`) are SWT-defined.

**Codex docs say** (`/codex/hooks`):
> Supported events: `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop` — total of 6.

**Status:** This is by design — Plan 05-03 explicitly framed the 6 new events as SDLC lifecycle hooks fired from SWT's command surface, not from Codex's runtime. The HookHost contract is methodology-layer, not Codex-runtime. **No action needed at the HookHost level**, but the codex-driver's hooks-writer must NOT attempt to translate the 6 SDLC events into Codex's `hooks.json` (Codex would reject unknown event names, or ignore them silently). The emit path should filter `HookEvent` to only the 6 v1.0 generic events when writing to Codex.

**Fix:** Verify the codex-driver's hooks-writer (e.g. `packages/codex-driver/src/hooks/writer.ts`) only emits the 6 v1.0 events to Codex. If it emits all 12, filter or whitelist. Add a unit test for this.

---

### F-10 🟠 MEDIUM — Hook event names need PascalCase translation when written to Codex

**Where:** Same as F-09 — codex-driver's hooks-writer.

**Codex docs say** (`/codex/hooks`):
- Event names are PascalCase: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`.

**SWT internal naming:** snake_case (`session_start`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `permission_request`, `stop`).

**Fix:** Ensure the hooks-writer translates SWT snake_case → Codex PascalCase when emitting `hooks.json` / `config.toml [[hooks.X]]`. Add a translation map. Add a unit test asserting the emitted JSON has PascalCase keys.

---

### F-11 🟠 MEDIUM — Codex hook config requires `[features] codex_hooks = true`

**Where:** SWT's hooks emitter (likely in codex-driver) and SWT's `ConfigSchema.hooks` block.

**Codex docs say** (`/codex/config-advanced`):
> Hooks are **experimental** and must be enabled via feature flag:
> ```toml
> [features]
> codex_hooks = true
> ```

**Status:** Without this flag, Codex won't process the hooks block. SWT's hooks emitter must include this when writing the user's `~/.codex/config.toml` (or warn if the user's existing config.toml lacks it).

**Fix:** Audit the codex-driver's hooks emit path. If it writes a `config.toml`, include `[features] codex_hooks = true`. If it writes a separate `~/.codex/hooks.json`, the feature flag still belongs in the user's main `config.toml` — emit a warning advising the user to add it.

---

### F-12 🟠 MEDIUM — SWT's `HookSubBlockSchema` doesn't express the full Codex hooks schema

**Where:** `packages/core/src/config/Config.ts:17-22`.

**SWT current:**
```typescript
const HookSubBlockSchema = z
  .object({
    script_path: z.string().min(1),
  })
  .optional();
```

**Codex actual `hooks.json` schema** (`/codex/hooks`):
```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "regex_pattern_or_tool_name",
        "hooks": [
          {
            "type": "command",
            "command": "script path or command",
            "statusMessage": "optional UI message",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

**Status:** SWT's flat `{script_path}` schema cannot express:
- Multiple hooks per event (Codex allows arrays)
- Per-hook matchers (Codex `matcher` filters which tool/source the hook applies to)
- Per-hook `statusMessage` (UI hint)
- Per-hook `timeout` (command timeout in seconds, default 600)
- Type discrimination (`type: "command"` is the only documented type today; future-proof for `type: "script"` or other variants)

**Fix:** Either:
1. **Keep SWT's simple schema** as a v1.5 abstraction; document that the codex-driver's emit path translates `{script_path}` to `[{matcher: "*", hooks: [{type: "command", command: script_path, timeout: 600}]}]`. This loses configurability but keeps the user-facing config simple.
2. **Expand SWT's HookSubBlockSchema** to mirror Codex's full schema:
   ```typescript
   const HookSubBlockSchema = z.object({
     matcher: z.string().optional(),
     hooks: z.array(z.object({
       type: z.enum(['command']).default('command'),
       command: z.string().min(1),
       statusMessage: z.string().optional(),
       timeout: z.number().int().positive().default(600),
     })).min(1),
   }).optional();
   ```
   This gives users full Codex expressivity but increases complexity.

**Recommendation:** Option 1 for v1.5 (already shipped), Option 2 as v1.6 enhancement. Document the simplification in the F7 follow-up notes.

---

### F-13 🟠 MEDIUM — Codex plugin manifest schema fields differ from SWT's

**Where:** `packages/cli/codex-plugin.json` (compared against `/codex/plugins/build`).

**Documented Codex schema (top-level):**
- Required: `name`, `version`, `description`
- Optional metadata: `author` (object {name, email, url}), `homepage`, `repository`, `license`, `keywords`
- Component pointers: `skills`, `mcpServers`, `apps`, `hooks` (all string paths)
- Presentation: `interface` block with `displayName`, `category`, `screenshots`, `defaultPrompt`, `brandColor`, `composerIcon`, `logo`, etc.

**SWT current top-level fields not in documented Codex schema:**
- `displayName` → should live inside `interface.displayName`
- `install` (object) — not in documented schema (Codex uses CLI auto-detect for npm packages, no manifest install hint)
- `commands` (array) — not at top level; commands are typically derived from skills, not declared in plugin.json
- `tags` → should be `keywords` (both are arrays of strings; `keywords` is the npm-aligned name Codex uses)
- `categories` → should be `interface.category` (singular per docs)
- `screenshots` → should be `interface.screenshots`

**SWT current fields with type mismatches:**
- `author` is a string `"Tiago Serôdio (@yidakee)"` — Codex schema expects an object `{name, email, url}`

**Missing component pointers:**
- `skills` (string path) — not declared
- `mcpServers` (string path to .mcp.json) — not declared
- `hooks` (string path) — not declared

**Fix:** Restructure to match the documented schema. Suggested:
```json
{
  "name": "stop-wasting-tokens",
  "version": "0.0.0",
  "description": "Token-disciplined SDLC for the Codex CLI...",
  "author": {
    "name": "Tiago Serôdio",
    "url": "https://github.com/yidakee"
  },
  "license": "MIT",
  "homepage": "https://docs.stopwastingtokens.dev",
  "repository": "https://github.com/swt-labs/stop-wasting-tokens",
  "keywords": ["methodology", "vibe-coding", "cli", "agents", "codex", "typescript", "monorepo"],
  "skills": "./skills/",
  "interface": {
    "displayName": "stop-wasting-tokens (SWT)",
    "category": "Development",
    "screenshots": ["screenshots/quickstart.png", "screenshots/lifecycle.png", "screenshots/uat-checkpoint.png"]
  }
}
```

---

### F-14 🟠 MEDIUM — `version: "0.0.0"` is unusual for a published plugin

**Where:** `packages/cli/codex-plugin.json:3`.

**Status:** A `0.0.0` version typically means "not yet published". When SWT actually ships to the marketplace (if/when self-serve publishing arrives — Codex docs say *"Adding plugins to the official Plugin Directory is coming soon. Self-serve plugin publishing and management are coming soon"*), the version should reflect reality. Currently the npm package version (in package.json) is the source of truth; the plugin manifest should match.

**Fix:** Sync `codex-plugin.json:version` with the npm package version. Could be done with a build-time codegen step similar to the F6 docs codegen. Or keep `0.0.0` and document that it's a deliberate pre-release marker until first publish.

---

### F-15 🟢 LOW — AGENTS.md fenced-block convention is undocumented (but harmless)

**Where:** Plan 01-01 `bootstrapHandler` — uses `<!-- SWT BEGIN --> ... <!-- SWT END -->` fences in AGENTS.md.

**Codex docs say** (`/codex/guides/agents-md`):
> The documentation does not address programmatic modification, fenced markers, or preservation rules. It recommends using `AGENTS.override.md` for temporary changes without deleting base files.

**Status:** The fence convention is a SWT extension. It doesn't conflict with Codex (Codex parses AGENTS.md as plain markdown — fences are just HTML comments). But:
- Codex's recommended approach is `AGENTS.override.md` for temporary changes
- SWT's fence approach co-mingles managed and user content in a single file

**Fix (optional — v1.6):** Consider whether SWT-managed content should live in `~/.codex/AGENTS.override.md` (per Codex convention) instead of fences in user's AGENTS.md. Pros: aligns with Codex idiom. Cons: scatter SWT state across two files. The current fenced approach works; this is a long-term style consideration.

---

### F-16 🟢 LOW — SWT's `verification_tier` is unrelated to Codex's named permission profiles

**Where:** SWT ConfigSchema `verification_tier: "quick" | "standard" | "deep"` (REQ-09, goal-backward QA tiers).

**Codex docs reveal** (`/codex/config-advanced`):
> Built-in profiles (prefixed with `:`) include `:read-only`, `:workspace`, and `:danger-no-sandbox`.

**Status:** No conflict — different concepts. `verification_tier` is SWT's QA effort dial; Codex's permission profile names (`:read-only`, etc.) are sandbox/network policies. Just noting the namespace overlap so SWT doesn't accidentally collide in future. **No action needed.**

---

### F-17 🟢 LOW — Cache discipline (REQ-05) needs an end-to-end measurement

**Where:** REQ-05 in REQUIREMENTS.md: "Cache-aware split prompts with stable static prefix".

**Codex/OpenAI docs say** (`/api/docs/guides/prompt-caching`):
> "Caching is enabled automatically for prompts that are 1024 tokens or longer."
> "the hash typically uses the first 256 tokens"
> "place static content like instructions and examples at the beginning of your prompt, and put variable content, such as user-specific information, at the end."
> "Use the `prompt_cache_key` parameter consistently across requests that share common prefixes."
> Verify cache hits via `usage.prompt_tokens_details.cached_tokens` in the response.

**Status:** SWT's design philosophy aligns. **What's missing:** an actual measurement that the static prefixes SWT generates (in the codex-driver's prompt construction code) are ≥1024 tokens AND that `cached_tokens` shows non-zero on the second call for the same role. This is a verification gap, not a design defect. The v1.5 milestone closed without an end-to-end cache-hit assertion test.

**Fix:** v1.6 follow-up: add a `packages/codex-driver/test/prompt-caching.test.ts` that constructs a Scout prompt twice, checks the response's `cached_tokens` field is >0 on the second call. Also verify the static prefix length is ≥1024 tokens for each role.

---

## Relevant Patterns

### Codex hook events (verbatim — for the codex-driver hook-writer):

| Event | When | Matcher | Exit-code behavior |
|---|---|---|---|
| `SessionStart` | startup, resume, clear | `source` filter (`startup`, `resume`, `clear`) | 0=success; non-zero=failure |
| `UserPromptSubmit` | before user prompt → model | none | 0=allow; 2=block w/ stderr reason |
| `PreToolUse` | before Bash, edits, MCP tools | tool name (e.g., `Bash`, `apply_patch`, `mcp__filesystem__read_file`) | 0=allow; 2=deny w/ stderr |
| `PostToolUse` | after tool produces output | tool name | 0=success; 2=block w/ stderr |
| `PermissionRequest` | when Codex seeks approval | tool name | 0=process decision; 2=deny |
| `Stop` | when conversation turn completes | none | 0=JSON expected; 2=stderr reason |

### Codex sandbox modes (verbatim):

- `read-only`: "Codex can inspect files, but it can't edit files or run commands without approval."
- `workspace-write` (default): "Codex can read files, edit within the workspace, and run routine local commands inside that boundary."
- `danger-full-access`: "Codex runs without sandbox restrictions. ... should be used only when you want Codex to act with full access."

### Codex approval policies (verbatim):

- `untrusted`: requires approval before running commands outside a trusted set
- `on-request` (default with `workspace-write`): works within sandbox by default; pauses when exceeding boundaries
- `never`: operates without approval prompts

### Codex MCP config schema (excerpt — `~/.codex/config.toml`):

```toml
[mcp_servers.<server-name>]
# STDIO server:
command = "/path/to/binary"
args = ["arg1", "arg2"]
env = { KEY = "value" }
env_vars = ["FORWARD_THIS_VAR"]
cwd = "/working/dir"

# HTTP server:
url = "https://server.example/"
bearer_token_env_var = "TOKEN_ENV"
http_headers = { "X-Custom" = "value" }

# Common optional:
enabled = true
required = false
startup_timeout_sec = 30
tool_timeout_sec = 60
enabled_tools = ["read_file"]
disabled_tools = ["delete_file"]
```

### Codex named permission profiles (verbatim):

```toml
default_permissions = ":workspace"

[permissions.workspace.filesystem]
":project_roots" = { "." = "write", "**/*.env" = "none" }
glob_scan_max_depth = 3

[permissions.workspace.network]
enabled = true
mode = "limited"

[permissions.workspace.network.domains]
"api.openai.com" = "allow"
```

Built-in: `:read-only`, `:workspace`, `:danger-no-sandbox`.

---

## Risks

- **Critical correctness risk**: F-01 + F-02 mean every SWT-spawned Codex agent today would fail to spawn (or silently fall back to default model + reasoning effort, losing per-role differentiation). This is the "v1.5 milestone shipped but doesn't actually work end-to-end against real Codex" risk.
- **Discoverability risk**: F-03 + F-13 mean the Codex Plugin Marketplace (when it ships) won't recognize SWT as a valid plugin without manifest restructuring.
- **Future-Codex risk**: F-05, F-06, F-07 use field names that may collide with future Codex schema additions. SWT-namespacing or removing them is the safe path.
- **Hook integration risk**: F-09 + F-10 + F-11 + F-12 mean SWT's hooks block won't actually wire up to Codex without the codex-driver's emit path doing translation. If that translation isn't there yet (likely — Plan 05-03 explicitly deferred the methodology-side dispatch), users today couldn't use SWT's hooks via Codex.

---

## Recommendations

### Tier 1 — must-fix before announcing v1.5 publicly (1–2 hours work)

1. **F-01 + F-02:** Edit all 6 agent template TOMLs to use `model = "gpt-5.3-codex"` (or `"gpt-5.5"`) and `model_reasoning_effort` ∈ {`minimal`, `low`, `medium`, `high`, `xhigh`}. Update the codex-plugin-manifest test to assert these are valid Codex enum values.
2. **F-04:** Add `name` and `description` fields to all 6 agent TOMLs.

### Tier 2 — Codex Plugin Marketplace prerequisites (3–5 hours work)

3. **F-03:** Move `packages/cli/codex-plugin.json` → `.codex-plugin/plugin.json` (repo root or wherever the published-package root is).
4. **F-13:** Restructure manifest fields per documented Codex schema: `tags` → `keywords`, flat presentation fields → `interface` block, `author` string → object, drop undocumented `install` and `commands` top-level fields.
5. **F-14:** Sync `version` with npm package version via build-time codegen.

### Tier 3 — methodology-side hook integration follow-up (1–2 days, paired with v1.5 follow-ups already tracked)

6. **F-09 + F-10 + F-11:** When the codex-driver's hooks-writer is wired up, ensure it (a) filters HookEvent to only the 6 v1.0 generic events, (b) translates snake_case → PascalCase, (c) emits `[features] codex_hooks = true` in the user's `config.toml`. Add unit tests for each.
7. **F-08:** Update the TOML header comment to reference `~/.codex/config.toml [mcp_servers.X]` instead of `~/.codex/mcp.json`.

### Tier 4 — long-term schema evolution (v1.6+)

8. **F-05 + F-06 + F-07:** Decide on either dropping or SWT-namespacing the SWT-specific TOML fields (`role`, `allowed_mcp_servers`, `max_turns`).
9. **F-12:** Expand `HookSubBlockSchema` to mirror Codex's full hooks.json schema (matchers, multiple hooks per event, statusMessage, timeout).
10. **F-15:** Consider migrating SWT-managed content from fenced AGENTS.md → `~/.codex/AGENTS.override.md` per Codex convention.
11. **F-17:** Add an end-to-end cache-hit measurement test for REQ-05 verification.

---

## What SWT got right (worth celebrating)

- **AGENTS.md over CLAUDE.md** (Plan 01-01): Correct for Codex.
- **Removed `$schema` placeholder** (Plan 01-02 DEV-2B): Correct — Codex docs don't require/document `$schema`.
- **`sandbox_mode = "read-only"` for scout**: Valid Codex enum value.
- **TOML format for agent profiles**: Codex docs reference TOML for both subagent files (`~/.codex/agents/{name}.toml`) and main config — SWT's choice aligns.
- **Hook event taxonomy intent** (F7): The 6 v1.0 events match Codex's 6 events 1:1. The 6 v1.5 SDLC events are a clean SWT extension that doesn't pollute Codex's namespace.
- **MCP server names labelled illustrative** (Plan 01-02 DEV-2C): Correct — there are no predefined Codex MCP servers; `filesystem` etc. are user-configured names.
- **Cache-aware prompt design intent** (REQ-05): Aligns with OpenAI's documented prefix-caching behavior (≥1024 tokens, static-first ordering, `prompt_cache_key` parameter).
- **AgentSpawner contract abstraction** (REQ-04): The pattern of `installAgent` / `spawn` / `removeAgent` per role maps cleanly to Codex's documented "spawn a new agent when you explicitly ask it" model.
- **Permission gate concept** (REQ-14): Aligns with Codex's `sandbox_mode` + `approval_policy` + named permission profiles structure.

---

## Sources

- [Codex Developer Portal (root)](https://developers.openai.com/codex)
- [Codex Hooks reference](https://developers.openai.com/codex/hooks)
- [Codex Config Reference](https://developers.openai.com/codex/config-reference)
- [Codex Advanced Config](https://developers.openai.com/codex/config-advanced)
- [Codex Sandboxing Concepts](https://developers.openai.com/codex/concepts/sandboxing)
- [Codex Plugins Overview](https://developers.openai.com/codex/plugins)
- [Codex Build Plugins (manifest spec)](https://developers.openai.com/codex/plugins/build)
- [Codex MCP Configuration](https://developers.openai.com/codex/mcp)
- [Codex AGENTS.md Guide](https://developers.openai.com/codex/guides/agents-md)
- [Codex Subagents](https://developers.openai.com/codex/subagents)
- [Codex Models](https://developers.openai.com/codex/models)
- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)
