# `swt migrate`

Migrate a v2.x `.swt-planning/` directory to the v3 schema. Per TDD2 §13.6.1 + Plan 06-01 PR-49.

> **Status (M6 PR-49, 2026-05-12):** ships. v2 → v3 only; future cross-version migrations follow the same scaffolding.

## Synopsis

```bash
swt migrate --to=v3 --input <v2-planning-dir> --output <v3-planning-dir>
```

| Flag       | Required | Purpose                                                                                                      |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `--to`     | optional | Target schema version. Only `v3` is supported today; omitting it defaults to `v3`. Non-v3 values exit USAGE. |
| `--input`  | yes      | v2.x planning directory to read. Never mutated.                                                              |
| `--output` | yes      | Target directory to write. Created if missing; existing content is overwritten.                              |

## What it does

The migration is **out-of-place** + **idempotent**:

1. **Copy the whole tree** from `--input` to `--output` (the input is never touched).
2. **Walk the output tree**; rewrite two field families wherever they appear:
   - **JSON files** — any `backend` field with a legacy value (`codex`, `claude-code`, `ollama`) becomes `'pi'`; any `agent_backend` field with `'codex'` or `'scripted'` becomes `'pi'`. Recursively traversed across nested objects + arrays.
   - **Markdown frontmatter** — `reasoning_effort: <X>` keys are renamed to `thinking_level: <X>`. The values (low / medium / high) carry over identically. Pi-native values (off / minimal / xhigh) only land via fresh authoring.
3. **Emit a migration report** with files scanned + fields rewritten + a list of touched paths.

The methodology layer is unchanged between v2 and v3 (TDD2 §13.6 Principle 2), so the migration is purely a vocabulary refresh. Plans, summaries, must-haves, milestone state, journals, lock files — all pass through verbatim.

## Sample output

```text
$ swt migrate --to=v3 --input ../old-project/.swt-planning --output ./.swt-planning
swt migrate --to=v3: complete.
  Input:  ../old-project/.swt-planning
  Output: ./.swt-planning
  Files scanned: 24
  Fields rewritten: 3
  - config.json: rewrote 1 field(s)
  - phases/01-bootstrap/01-01-PLAN.md: renamed 1 frontmatter field(s)
  - snapshot.json: rewrote 1 field(s)
```

When the input directory is already v3-shaped:

```text
$ swt migrate --to=v3 --input ./.swt-planning --output ./.swt-planning-copy
swt migrate --to=v3: complete.
  Input:  ./.swt-planning
  Output: ./.swt-planning-copy
  Files scanned: 24
  Fields rewritten: 0
  (No notes.)
```

## Exit codes

| Code | Meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 0    | Migration complete; report printed to stdout.                                                          |
| 1    | `EXIT.USAGE_ERROR` — missing `--input` / `--output`, or `--to` supplied with a non-`v3` value.         |
| 2    | `EXIT.NOT_IMPLEMENTED` — `--input` directory does not exist.                                           |
| 3    | `EXIT.RUNTIME_ERROR` — unexpected fs / parse error mid-migration. The output directory may be partial. |

## What gets migrated (and what doesn't)

| v2 field / value                                  | v3 form                           | Notes                                                                                                         |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `backend: 'codex' \| 'claude-code' \| 'ollama'`   | `backend: 'pi'`                   | Per ADR-005 + ADR-001 (Pi-only runtime).                                                                      |
| `agent_backend: 'codex' \| 'scripted'`            | `agent_backend: 'pi'`             | Dashboard SSE snapshot field.                                                                                 |
| `reasoning_effort: low/medium/high` (frontmatter) | `thinking_level: low/medium/high` | Pi-native `ThinkingLevel` vocabulary. v2 only ever used low/medium/high; off/minimal/xhigh are net-new in v3. |
| Plan + summary + milestone + journal artefacts    | _unchanged_                       | Methodology is preserved verbatim (TDD2 §13.6 Principle 2).                                                   |
| `.swt-planning/cassettes/`                        | _unchanged_                       | Cassettes are provider-portable per ADR-011; v2 recordings replay against v3 without re-recording.            |
| `.swt-planning/.tpac/` (M4 output)                | _unchanged_                       | TPAC report JSON shape is the same across versions (frozen at schema_version: 1).                             |
| `.swt-planning/locks/` + `.swt-planning/journal/` | _unchanged_                       | Worktree FSM state is forward-compatible.                                                                     |

## Operator workflow

The typical v2 → v3 migration session:

```bash
# 1. Verify your v2 project on its current branch.
cd ~/my-project
git status

# 2. Run the migration out-of-place. The input is never mutated.
npx stop-wasting-tokens@3 migrate --to=v3 \
  --input .swt-planning \
  --output .swt-planning-v3

# 3. Inspect the migration report; verify field counts match expectations.

# 4. Replace the original directory.
mv .swt-planning .swt-planning-v2-backup
mv .swt-planning-v3 .swt-planning

# 5. Run `swt status` to confirm v3 reads it cleanly.
npx stop-wasting-tokens@3 status

# 6. Once verified, archive the backup.
tar czf swt-planning-v2-backup.tar.gz .swt-planning-v2-backup
rm -rf .swt-planning-v2-backup
```

The backup is your insurance — keep it for the v2.3.x LTS window (6 months per ADR-012) until you're confident v3 is stable in your workflow.

## See also

- **TDD2 §13.6.1** — M6 PR-49 specification
- **[`docs/operations/migrating-from-v2.md`](../../operations/migrating-from-v2.md)** — the full operator-facing migration guide
- **[ADR-005](../../decisions/ADR-005-delete-legacy-drivers.md)** — why `codex` / `claude-code` / `ollama` backends were removed wholesale
- **[ADR-012](../../decisions/ADR-012-six-month-lts-policy.md)** — v2.3.x LTS support window
- **[`packages/cli/src/commands/migrate.ts`](../../../packages/cli/src/commands/migrate.ts)** — the CLI handler
