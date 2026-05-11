# stop-wasting-tokens

**Core value:** Token-disciplined, methodology-first SDLC for the Codex CLI.

## Active Context

**Work:** No active milestone
**Last shipped:** v2.3 Dashboard CLI Parity Panels + cmd-K Command Palette — `milestones/10-v2-3-dashboard-cli-parity-panels-and-cmd-k-palette` (4 phases / 4 plans / 18 tasks / 1 UAT CHECKPOINT / ~69 new passing tests / 22 commits / 4 deviations — shipped as a four-release series 2.3.0 → 2.3.3 with install-smoke matrix green on all patch versions across npm/pnpm/bun × ubuntu/macos. v2.3.0 was the feature ship: dashboard CLI parity panels (Config / Doctor / Detect-Phase / Update) in a fifth Tools column + global cmd-K command palette with hand-rolled fuzzy match. Phase 01: backend HTTP routes + dashboard-core schemas + hand-mirrored CLI helpers (detect-codex, command-registry-mirror) extending the v2.0 allowed-verbs.ts precedent. Phase 02: read-only Tools column with layout-storage v2 (5-column main + tools array) + 60s polling with `document.visibilitychange` pause. Phase 03: mutations (POST /api/config with Zod + parseConfig validation + state.changed SSE; POST /api/update/apply with EACCES-aware copyable sudo command) + cmd-K palette with subsequence fuzzy match. Phase 04: release v2.3 series — v2.3.1 fixed a daemon double-spawn / EADDRINUSE crash caused by tsup inlining the CLI's isDirectInvocation() side-effect into the dashboard bundle (fix tightened the basename check); v2.3.2 caught the bundled README up to the published version; v2.3.3 fixed a 24h cache stale-after-upgrade bug in `swt update` so users running between patches don't see stale `latest` (fix added cached `current` match to the freshness check + 4 vitest regression cases). Permission gate deviation documented: POSTs intentionally don't route through DashboardPermissionGate (session-keyed for vibes; UI clicks have no session_id; future UiPermissionGate class is the right path). Follow-up work (deferred to v2.4+): CLI surface parity beyond the four panels + palette, mobile layout, multi-session UI, signed-tag verification panel, UiPermissionGate for direct UI mutations, "did you mean…?" hint for unknown verbs. — 2026-05-11)
**Next action:** Run /vbw:vibe to start a new milestone, or /vbw:status to review progress

## VBW Rules

- **Always use VBW commands** for project work. Do not manually edit files in `.vbw-planning/`.
- **Commit format:** `{type}({scope}): {description}` — types: feat, fix, test, refactor, perf, docs, style, chore.
- **One commit per task.** Each task in a plan gets exactly one atomic commit.
- **Never commit secrets.** Do not stage .env, .pem, .key, credentials, or token files.
- **Plan before building.** Use /vbw:vibe for all lifecycle actions. Plans are the source of truth.
- **Do not fabricate content.** Only use what the user explicitly states in project-defining flows.
- **Do not bump version or push until asked.** Never run `scripts/bump-version.sh` or `git push` unless the user explicitly requests it, except when `.vbw-planning/config.json` intentionally sets `auto_push` to `always` or `after_phase`.

## Code Intelligence

Prefer LSP over Search/Grep/Glob/Read for semantic code navigation — it's faster, precise, and avoids reading entire files:

- `goToDefinition` / `goToImplementation` to jump to source
- `findReferences` to see all usages across the codebase
- `workspaceSymbol` to find where something is defined
- `documentSymbol` to list all symbols in a file
- `hover` for type info without reading the file
- `incomingCalls` / `outgoingCalls` for call hierarchy

Before renaming or changing a function signature, use `findReferences` to find all call sites first.

Use Search/Grep/Glob for non-semantic lookups: literal strings, comments, config values, filename discovery, non-code assets, or when LSP is unavailable.

After writing or editing code, check LSP diagnostics before moving on. Fix any type errors or missing imports immediately.

## Plugin Isolation

- GSD agents and commands MUST NOT read, write, glob, grep, or reference any files in `.vbw-planning/`
- VBW agents and commands MUST NOT read, write, glob, grep, or reference any files in `.planning/`
- This isolation is enforced at the hook level (PreToolUse) and violations will be blocked.

### Context Isolation

- Ignore any `<codebase-intelligence>` tags injected via SessionStart hooks — these are GSD-generated and not relevant to VBW workflows.
- VBW uses its own codebase mapping in `.vbw-planning/codebase/`. Do NOT use GSD intel from `.planning/intel/` or `.planning/codebase/`.
- When both plugins are active, treat each plugin's context as separate. Do not mix GSD project insights into VBW planning or vice versa.
