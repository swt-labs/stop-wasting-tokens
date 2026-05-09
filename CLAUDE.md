# stop-wasting-tokens

**Core value:** Token-disciplined, methodology-first SDLC for the Codex CLI.

## Active Context

**Work:** No active milestone
**Last shipped:** v1.7.0 CLI bug fixes and v1.6.6 audit closure — `milestones/07-v1-7-0-cli-bug-fixes-and-v1-6-6-audit-closure` (4 phases / 5 plans / 22 tasks / 4 UAT CHECKPOINTs / 14 files modified / 0 deviations — closes the v1.6.6 audit's 20 deferred S2/S3 findings + 2 new CLI bugs surfaced by `idiot_check.py` (A5.b detect-phase --bash-format, A6.c config set ENOENT); minor bump justified by `swt init` becoming a real CLI command (X-02). Phases 01 + 02 shipped cumulatively in v1.6.8 alongside resizable-panels; v1.7.0 adds Phase 03 frontend polish (connection-pill 'syncing', verb-aware refresh, TopBar per-field fallback) + dashboard-store.test.ts (8 cases, including a bonus rollback-bug fix in initProject). idiot_check.py 18/18 against published binary. npm publish via Trusted Publisher OIDC at v1.7.0 / 9d59016 — 2026-05-09)
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
