---
audience: v2.x users migrating to v3.0
last_updated: 2026-05-11
canonical_path: docs/operations/migrating-from-v2.md
script: swt migrate --to=v3
---

# Migrating from v2.x to v3.0

This guide walks you from a v2.3.x SWT project to v3.0. v3 is a runtime-layer
rewrite — the Codex CLI subprocess (v2) is replaced by the vendor-neutral
[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
runtime (v3). The methodology you already use — six-agent SDLC, plan-then-execute
phases, `.swt-planning/` artefacts, must-haves, goal-backward QA — is **preserved
verbatim**. What changes is the engine underneath: how the harness talks to
models, how it dispatches parallel tasks, how it caches prompts, how it bills you.

If you've been on v2.x for a while, this migration is mostly mechanical. The
`swt migrate --to=v3` script (M6 PR-49) does the bulk of the work; this guide
explains what it does and how to verify the result.

> **v2.3.x support posture.** v2.3.x receives no further patches after v3.0
> ships. The previously-planned 6-month LTS window (ADR-012) was retracted
> same-day. Historical v2.3.x tarballs remain on npm; pin to a specific patch
> if you cannot migrate immediately, and run `swt migrate --to=v3` when ready.

## What changed at a glance

The most common v2 concepts and where they live in v3:

| v2 concept                               | v3 concept                                                | Notes                                                                |
| :--------------------------------------- | :-------------------------------------------------------- | :------------------------------------------------------------------- |
| `@swt-labs/codex-driver`                 | Pi `anthropic` / `openai` / `openrouter` provider         | One runtime, 25+ providers via Pi's native catalogue                 |
| `@swt-labs/claude-code-driver`           | Pi `anthropic` provider                                   | Same Anthropic API surface                                           |
| `@swt-labs/ollama-driver`                | Pi `ollama` provider                                      | Same `OLLAMA_HOST` + `/api/chat` surface                             |
| `backend: codex` in `config.json`        | `roles[*].tier` + provider via tier-routed router         | Tier vocabulary: `cheap-fast` / `balanced` / `quality` / `reasoning` |
| `codex hooks/*` config                   | Pi events (`agent_start`, `tool_execution_*`, `turn_end`) | Hook surface is now event-driven via the runtime adapter             |
| `shouldStopAfterTurn` / `report_result`  | `swt_report_result` Pi Extension custom tool              | Per ADR-002; the v2 names were never real Pi primitives              |
| `reasoning_effort: high` on AgentSpec    | `thinking_level: high` (Pi `ThinkingLevel` vocab)         | Cascade rename lands in v3.1.x via the migration script              |
| `.swt-planning/parallel/` (empty in v2)  | One git worktree per parallel task                        | Per ADR-008 — Dev tasks isolate at the FS boundary                   |
| `.codex-plugin/` MCP wiring              | Pi extensions (`runtime/extensions/`)                     | The MCP shim is gone; Pi handles tool registration                   |
| Manual cache-control prompt construction | `buildPrompt()` with `cacheBreakpointIndex`               | Per ADR-006 — breakpoint after artefacts, before task                |

If your v2 project used a custom `agents.md` with per-role TOML blocks, those
become standard `AGENTS.md` (single file, no per-role variants — Pi reads
this natively).

## Pre-migration checklist

Run through this before invoking the migration script. The script does not
auto-backup; you are expected to commit or back up explicitly.

1. **Verify your `.swt-planning/` is committed.** A clean working tree is the
   safest pre-migration state. If you have in-flight phase work, complete it
   on v2.3.x first — v3 does not auto-resume in-flight v2 sessions.

2. **Verify your project is on v2.3.5.** The migration script supports
   v2.3.0..v2.3.5. Earlier v2 minors need an intermediate upgrade first:

   ```bash
   npm install -g stop-wasting-tokens@2.3.5
   swt --version    # confirm 2.3.5
   ```

3. **Back up your `.swt-planning/` explicitly.** The script does NOT back
   up automatically (verified design decision — explicit user control over
   their planning data). Run:

   ```bash
   cp -r .swt-planning .swt-planning.v2-backup
   ```

   If you trust git, a commit on a `pre-v3-migration` branch is equivalent.

4. **Verify your team has read the changelog.** v3 deletes three driver
   packages; if any of your custom scripts source-import from
   `@swt-labs/codex-driver` / `@swt-labs/claude-code-driver` /
   `@swt-labs/ollama-driver`, they will break. Search your repo before
   migrating:

   ```bash
   grep -rE "from '@swt-labs/(codex|claude-code|ollama)-driver'" .
   ```

5. **Confirm the cassette policy.** v3 ships with cassette-based deterministic
   tests for the provider matrix (per ADR-011). If your CI relies on real LLM
   API keys, the migration script does not touch your CI config — but the
   v3 test infrastructure expects cassettes, not live keys. Plan a follow-up
   pass on your `.github/workflows/` after migration.

## Running the migration script

```bash
npm install -g stop-wasting-tokens@3
swt migrate --to=v3
```

The script is idempotent: running it twice on an already-migrated project is a
no-op. It detects v2 state via the absence of `schema_version` in your
`config.json` and the presence of the `backend:` field. If neither marker
applies, it surfaces an explicit error rather than guessing.

The script runs in your project root (the parent of `.swt-planning/`). It does
not require network access and does not contact npm during the transformation
pass — `npm install -g stop-wasting-tokens@3` already happened in step one.

If the script encounters an unrecognised `backend:` value (rare; v2.3.5 ships
with `codex` / `claude-code` / `ollama`), it stops with a structured error
listing the unrecognised value and the available v3 provider names. You then
either edit `config.json` to a recognised v2 value and re-run, or migrate by
hand using this guide's "What the script does" section as your reference.

## What the script does

The transformation pass per artefact, mirroring TDD2 §11.3:

**`config.json`** — the primary file the script rewrites:

- Removes `backend:` field. The backend is Pi; the per-call provider lives
  in `roles[*].tier` + the new `router_strategy:` field.
- Adds `roles[*].tier` per role: Scout → `cheap-fast`, Architect → `quality`,
  Lead → `balanced`, Dev → `balanced`, QA → `balanced`, Debugger → `reasoning`.
  These defaults match `DEFAULT_ROLE_TIERS` in `runtime/src/providers/role-resolver.ts`;
  you can edit them after migration to match your project's needs.
- Adds `router_strategy: 'tier-routed'` (default; other valid values are
  `pinned`, `round-robin`, `cost-optimized`, `quality-pinned-cost-failover`
  — per M5 PR-43).
- Adds top-level `schema_version: 1`. **This marker is added at migrate-time,
  NOT retroactively.** v2.x projects continue without a version field; v3.0
  projects gain `schema_version: 1` when this script runs. The schema
  contract is forward-only — future bumps (`schema_version: 2`, etc.)
  follow the same pattern.

**PROJECT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md** — no content change.
These files carry methodology data that v3 reads the same way v2 did. The
`schema_version: 1` marker on `config.json` covers the whole `.swt-planning/`
tree (one marker per project, not per file).

**`phases/NN-slug/plan-NN.md`** — gains two empty arrays in the frontmatter:

- `claims: []` — used by M3's claim registry (per ADR-008).
- `depends_on: []` — used by the DAG resolver for parallel batches.

For legacy plans without inter-task dependencies, the empty arrays are correct;
your plans run sequentially until you explicitly populate either field.

**New directories** — created empty, populated lazily as work flows:

- `.swt-planning/parallel/` — M3 worktree-per-task root (per ADR-008).
- `.swt-planning/journal/` — runtime event journal (per Plan 01-02 PR-09).
- `.swt-planning/locks/` — M3 lease locks.

**New file** — `.swt-planning/budget-state.json` initialised to zeros (per
ADR-007; the Budget Gate reads this).

**`AGENTS.md`** — if your v2 project had `.swt-planning/agents.md` with
per-role TOML blocks, the script consolidates them into a single root-level
`AGENTS.md` per Pi's native convention. Custom rules are preserved; the
per-role wrapping is removed.

**`.codex-plugin/`** — if present, the directory is **deleted** (it was
scaffolding for the v2 codex-driver's MCP plugin manifest and has no v3
counterpart). Custom files inside are reported in a warning before
deletion so you can rescue them if needed.

The script logs every file it touches to `.swt-planning/migration-log-YYYY-MM-DD.json`.
This log is your auditable record of what changed; keep it committed alongside
your other planning data.

## Verification

Run `swt doctor` after migration:

```bash
swt doctor
```

Expected output (a clean migration):

```
SWT doctor:
  ✓ Node v20.x
  ✓ Pi peer-dep resolved (@earendil-works/pi-coding-agent ^0.74.0)
  ✓ .swt-planning/ present
  ✓ schema_version: 1 (v3 active)
  ✓ No legacy driver imports
```

If `Pi peer-dep resolved` is missing, your `package.json` doesn't have
`@earendil-works/pi-coding-agent` as a peer dependency at the workspace root.
Re-run `swt install` or add the dep manually.

If `schema_version: 1` is missing, the migration didn't complete — re-run
`swt migrate --to=v3 --resume` to pick up where it stopped.

If any legacy driver imports are still detected, the diagnostic includes the
exact files + line numbers. These are usually custom scripts in `scripts/`
that referenced the driver packages directly. Search-and-replace per the
"What changed at a glance" table; commit; re-run `swt doctor`.

Then run `swt status` to verify your phase state is intact:

```bash
swt status
```

This should report the same phase position you had on v2.3.5. Phase progress
percentages, plan counts, and SUMMARY.md status fields are all preserved
verbatim across the migration.

## Backing out

The script is reversible if you committed first. Three paths:

**Path A — git revert** (if you committed the migration as one diff):

```bash
git log --oneline | head -5
# find the migration commit
git revert <migration-commit-sha>
npm install -g stop-wasting-tokens@2.3.5
```

**Path B — backup restore** (if you took the `cp -r .swt-planning .swt-planning.v2-backup` step):

```bash
rm -rf .swt-planning
mv .swt-planning.v2-backup .swt-planning
npm install -g stop-wasting-tokens@2.3.5
```

**Path C — uncommitted-changes recovery** (if you didn't commit and don't have a backup):
The migration log at `.swt-planning/migration-log-YYYY-MM-DD.json` contains
the original values for every field touched. The script's `--undo` mode reads
this log and reverses the transformations. Note: this path is best-effort;
explicit backups (A or B) are recommended.

After backing out, your project is on v2.3.x again. There is no v2.3.x patch
stream — pin a specific tarball on npm and plan a re-migration when you can.

## FAQ

**Will my custom skills still work?**

Yes. Pi's skill discovery loads from `.pi/skills/` or `.swt-planning/skills/`
— if your skills live in either location, no change required. Skills that
referenced the codex CLI directly (rare; usually skills are model-agnostic)
need a one-line edit to call the v3 spawner instead.

**What if I used the Claude Code or Ollama backend?**

v3 uses Pi as the only runtime; Pi has native providers for both. Update
`.swt-planning/config.json` per the new tier format:

```jsonc
// v2 example (deleted)
{ "backend": "claude-code" }

// v3 equivalent
{
  "schema_version": 1,
  "router_strategy": "tier-routed",
  "roles": {
    "scout":     { "tier": "cheap-fast", "provider": "anthropic" },
    "architect": { "tier": "quality",    "provider": "anthropic" },
    "dev":       { "tier": "balanced",   "provider": "anthropic" }
  }
}
```

The `provider:` per role is optional — if omitted, the router strategy
picks. With `pinned`, a missing provider falls back to the project default.

**Will v2.x still get patches?**

No. The 6-month LTS window planned in ADR-012 was retracted same-day as
the v3.0 structural close. v2.3.x receives no further patches; pin to a
specific v2.3.x tarball on npm if you cannot migrate immediately. The
supported path is `swt migrate --to=v3`.

**Is my data backed up automatically?**

No. The migration script does NOT auto-backup. You are expected to commit
or back up before migrating (per the Pre-migration checklist). This is a
deliberate design decision — explicit user control over planning data.

**Can I run both v2 and v3 in the same repo?**

No; they're mutually exclusive. The migration script rewrites `config.json`
in-place; v2 reads the old shape and v3 reads the new one. To run both for
A/B comparison purposes, keep two separate repository clones.

**Will my git history survive the migration?**

Yes. The script never rewrites git history. It only adds new commits (one
per artefact transformation, atomically) and stages the result for your
review. You commit the migration as a single squash commit if you prefer
the cleaner log.

**What about the v2.3.5 test failures the project shipped with?**

v3 inherited them via the M1 Foundation branch cut. M1 Plan 01-03 PR-11
remediates them — either fixes, deletes (obsolete tests for deleted driver
code), or `it.skip(...)`s with tracking-issue URLs. After PR-11 merged,
`ci.yml`'s Test step became required (no `continue-on-error`). Your
migrated project picks up the fixes the moment you upgrade to v3.0.

## Known migration issues

Documented edge cases discovered during the M6 PR-49 migration-script test
suite. At M1, this section is a placeholder — no edge cases known yet because
the script doesn't exist on disk (M6 PR-49 territory). Re-checking this section
before you migrate is a low-cost step that catches surprises.

_(no entries yet)_

---

If your migration fails in a way this guide doesn't cover, file an issue at
[`swt-labs/stop-wasting-tokens/issues`](https://github.com/swt-labs/stop-wasting-tokens/issues)
with the label `v3-migration` and attach the contents of
`.swt-planning/migration-log-YYYY-MM-DD.json`.
