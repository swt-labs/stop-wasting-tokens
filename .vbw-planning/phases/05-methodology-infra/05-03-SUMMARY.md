---
phase: 05
plan: 05-03
title: F7 — six new hook events + narrowing helpers + sample scripts
status: complete
completed: 2026-05-07
tasks_completed: 4
tasks_total: 4
commit_hashes:
  - 23cec4b
deviations:
  - "Plan 05-03 originally listed source + test + sample-script files but did not list `docs/reference/config.mdx`. Adding the `hooks` block to ConfigSchema in T2 changed the codegen output for config.mdx, so the file needed regenerating + committing to keep the Plan 05-02 drift check green. Plan-amendment: amended files_modified to include `docs/reference/config.mdx` before regenerating."
pre_existing_issues: []
ac_results:
  - criterion: "the HookEvent union in @swt-labs/core is extended with: pre_archive, post_phase, pre_phase, post_uat_fail, pre_qa, post_qa"
    verdict: "pass"
    evidence: "packages/core/src/abstractions/HookHost.ts now has the 12-variant union (6 v1.0 generic + 6 v1.5 SDLC lifecycle). The two tiers are commented inline."
  - criterion: "ConfigSchema gains a `hooks` block (optional) with one optional sub-block per event"
    verdict: "pass"
    evidence: "Config.ts adds `HookSubBlockSchema = z.object({script_path: z.string().min(1)}).optional()` and a `hooks` block in ConfigSchema with all 12 event keys. parseConfig({hooks: {pre_archive: {script_path: '/tmp/x.sh'}}}) succeeds; parseConfig({hooks: {pre_archive: {script_path: ''}}}) throws (min 1)."
  - criterion: "narrowing helpers ship in HookHost.ts: 12 helpers, one per event, each is a TypeScript type guard"
    verdict: "pass"
    evidence: "12 functions exported: isSessionStartEvent / isUserPromptSubmitEvent / isPreToolUseEvent / isPostToolUseEvent / isPermissionRequestEvent / isStopEvent / isPreArchiveEvent / isPostPhaseEvent / isPrePhaseEvent / isPostUatFailEvent / isPreQaEvent / isPostQaEvent. Each follows `ctx is HookContext & { event: <literal> }` shape. hook-host-narrowing.test.ts case 5 verifies the TypeScript narrowing at compile-time."
  - criterion: "each new event has a sample shell script under templates/hooks/{event}.sample.sh (executable + documented + harmless on dry-run)"
    verdict: "pass"
    evidence: "ls -la templates/hooks/ shows 6 files mode `-rwxr-xr-x` (0755). Each file's first line is `#!/usr/bin/env bash`. Each documents the env vars SWT passes + the use case + exit-code semantics. Bodies are printf-only — no destructive operations."
  - criterion: "existing post_archive semantics unchanged"
    verdict: "pass"
    evidence: "Plan 05-03 does NOT modify scripts/post-archive-hook.sh (the v1.0 dispatcher invoked from the archive flow). The 6 NEW events are additive; existing dispatchers continue to fire post_archive as they did in v1.0."
  - criterion: "the v1.0 6-event taxonomy is preserved alongside the 6 new events for a total of 12 events"
    verdict: "pass"
    evidence: "ALL_HOOK_EVENTS const has length 12, asserted by hook-host-narrowing.test.ts case 6. The test iterates the const and confirms each event passes its helper."
---

F7 ships. Hook event taxonomy expanded from 6 to 12; narrowing helpers + sample scripts complete the methodology layer's hook surface for the v1.5 ship. Methodology-side dispatch (firing each new event from the right command) is documented as a v1.5 follow-up.

## What Was Built

- **`packages/core/src/abstractions/HookHost.ts`** — extends `HookEvent` union to 12 variants; exports `ALL_HOOK_EVENTS` runtime const + 12 narrowing helpers (one per event).
- **`packages/core/src/config/Config.ts`** — adds `HookSubBlockSchema` + `hooks` block in ConfigSchema with all 12 event keys.
- **`packages/core/test/abstractions/hook-host-narrowing.test.ts`** — 6 vitest cases.
- **`templates/hooks/{pre-archive,post-phase,pre-phase,post-uat-fail,pre-qa,post-qa}.sample.sh`** — 6 executable bash sample scripts.
- **`docs/reference/config.mdx`** — regenerated via `pnpm docs:gen` to include the new `hooks` block (required to keep Plan 05-02's drift check green).

## Files Modified

- `packages/core/src/abstractions/HookHost.ts` (12-event union + 12 helpers)
- `packages/core/src/config/Config.ts` (HookSubBlockSchema + hooks block)
- `packages/core/test/abstractions/hook-host-narrowing.test.ts` (new — 6 cases)
- `templates/hooks/pre-archive.sample.sh` (new)
- `templates/hooks/post-phase.sample.sh` (new)
- `templates/hooks/pre-phase.sample.sh` (new)
- `templates/hooks/post-uat-fail.sample.sh` (new)
- `templates/hooks/pre-qa.sample.sh` (new)
- `templates/hooks/post-qa.sample.sh` (new)
- `docs/reference/config.mdx` (regenerated — see deviation #1)

## Deviations

See frontmatter `deviations:`. One:

1. **docs/reference/config.mdx amendment (plan-amendment)** — adding the `hooks` block to ConfigSchema changed the codegen output. files_modified amended to include the regenerated config.mdx so the Plan 05-02 drift check stays green.

## Verification

1. ✅ `pnpm --filter @swt-labs/core typecheck` exits 0
2. ✅ `pnpm vitest run packages/core/test/abstractions/hook-host-narrowing.test.ts` — 6/6 pass
3. ✅ `pnpm vitest run test/docs/drift.test.ts` — 3/3 pass after regeneration (drift stays green)
4. ✅ `ls -la templates/hooks/` shows 6 executable sample scripts
5. ✅ The v1.0 `post_archive` semantics are preserved (no edits to scripts/post-archive-hook.sh)

## Next

Phase 05 fully built (3/3 plans). Routing should advance to Phase 05 verify (QA + UAT) on the next `/vbw:vibe`. The v1.5 milestone's last phase ships.
