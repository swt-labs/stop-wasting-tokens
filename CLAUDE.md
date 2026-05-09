# stop-wasting-tokens

**Core value:** Token-disciplined, methodology-first SDLC for the Codex CLI.

## Active Context

**Work:** No active milestone
**Last shipped:** v2.0 Natural-Language-First Dashboard — `milestones/08-v2-0-natural-language-first-dashboard` (5 phases / 11 plans / 53 tasks / 5 UAT CHECKPOINTs / ~107 new passing tests / 8 commits / 2 deviations — major-version pivot from "methodology in your terminal" to "dashboard IS the methodology surface, terminal is for power users." Bare `swt` now opens the dashboard daemon; `SWT_NO_DASHBOARD=1` restores legacy help. Phase 1: locked architecture in `v2-permission-model.md` + `v2-agent-prompt-protocol.md`. Phase 2: `agent.prompt` SSE schema, vibe session module with disk JSONL, `POST /api/vibe` + `/api/vibe/:id/reply`, marker protocol, ScriptedAgent test double, CodexMethodologyAgent production runner (opt-in via `SWT_VIBE_AGENT=codex`). Phase 3: `DashboardPermissionGate` with classification + session-scoped allowlist + visual-distinct amber-shield permission cards. Phase 4: natural-language command bar, chat-style conversation in LogPanel, empty-state CTA, first-run 3-step explainer. Phase 5: bump 1.7.1 → 2.0.0, CHANGELOG with full migration notes, OIDC publish, v2.0.0 tag at 4f93afa. idiot_check.py 18/18 against published binary. Follow-up work: agent-prompt template updates so real Codex emits ASK_USER markers + production-default flip + daemon restart resumption — all out of scope for 2.0.0; tracked in `milestones/08-...` SHIPPED.md "What did NOT ship" section. — 2026-05-09)
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
