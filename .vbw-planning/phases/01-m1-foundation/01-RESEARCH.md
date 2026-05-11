---
phase: 1
title: M1 Foundation — Research
type: research
confidence: high
date: 2026-05-11
---

# Phase 1: M1 Foundation — Research

> **Authoritative design:** `TDD2.md` (root) — §11.5 (edge break), §13.1 (M1 milestone), §6 (package layout), §5 (Pi SDK reference).
> **Reference v2 source:** `.vbw-planning/research/swt-v2-source/` (read-only clone of `swt-labs/stop-wasting-tokens` @ v2.3.5).
> **Reference recon:** `.vbw-planning/research/recon.md`.

## Findings

### F-01 · Two constitutional-debt edges block any Pi work (verified)

v2.3.5 has two source-import edges that violate Principle 1 (methodology vendor-neutrality) and Principle 3 (provider as parameter). Both must be discharged as the M1 **entry gate** before any new `packages/runtime/` work begins.

| Edge | Concrete site | Type | Symbol(s) imported |
|---|---|---|---|
| methodology → codex-driver | `packages/methodology/src/vibe/handlers/bootstrap.ts` | source import | `writeAgentsMdBlock` |
| cli → codex-driver (1) | `packages/cli/src/commands/vibe.ts` | source import | `CodexAgentSpawner` |
| cli → codex-driver (2) | `packages/cli/src/commands/doctor.ts` | source import | `detectCodexVersion`, `CodexVersion` |

Beyond source imports, `packages/cli/package.json` declares `@swt-labs/claude-code-driver` and `@swt-labs/ollama-driver` as workspace deps but contains no source imports for them — those dependency rows vanish trivially with PR-05 (driver-package deletion).

### F-02 · `core/abstractions/AgentSpawner` already exists (verified)

`packages/core/src/abstractions/AgentSpawner.ts` is the v2.3.5 abstraction that the methodology was *intended* to depend on before the codex-driver edge sneaked in. Re-routing `bootstrap.ts` to use this abstraction (rather than calling `writeAgentsMdBlock` directly) is the discharge for the methodology edge.

The CLI edges need a sibling abstraction. TDD2§13.1.2 specifies `core/abstractions/SpawnerEnvironment` (new minimal adapter) for `doctor.probe()` and `vibe`'s spawner-request surface.

Other abstractions already present and v3-compatible: `HookHost`, `MemoryStore`, `PermissionGate`, `Prompter`.

### F-03 · Pi SDK package namespace + peer-dep policy (verified)

Real npm packages (per `pi.dev/docs/latest`):

- `@earendil-works/pi-coding-agent` — main package
- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-tui` (not consumed directly by SWT v3)

Pi docs recommend listing core packages as `"peerDependencies": "*"` (not direct deps). SWT v3 follows this: `packages/runtime/` is the only package that lists Pi as both `dependencies` (so it can `import`) and `peerDependencies` (the adapter pattern for npm).

Typebox is a transitive concern: Pi tool definitions use `@sinclair/typebox` for parameter schemas — list as runtime dep in `packages/runtime/` only.

### F-04 · Pi SDK API surface that M1 actually consumes

For M1 (no worktrees, no parallel, no real LLM calls — just the scaffolding), the Pi surface area is small:

```ts
import {
  createAgentSession,           // factory: returns AgentSession
  createAgentSessionRuntime,    // wraps for run modes
  runPrintMode,                 // CLI-style one-shot
  defineTool,                   // for custom tools (M3 will use this for swt_report_result)
  SessionManager,               // .inMemory() for ephemeral sessions in tests
  createCodingTools,            // bound to a cwd
  createReadOnlyTools,          // for Scout role (M2+)
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,            // for M3+ extensions
} from '@earendil-works/pi-coding-agent';
```

The full Pi reference is TDD2§5; M1 only needs `createAgentSession`, event subscription, and the tool factories.

### F-05 · 11-package workspace; 3 packages delete cleanly in PR-05

v2.3.5 contains 11 packages (verified via `ls packages/`):

| v2 package | M1 disposition | v3 location |
|---|---|---|
| `@swt-labs/core` | preserve (split abstractions/handoff/scaffold remain in core; types→shared) | `@swt-labs/core/abstractions/` etc. |
| `@swt-labs/artifacts` | preserve (renamed to British) | `@swt-labs/core/artefacts/` |
| `@swt-labs/methodology` | preserve (dep-edge break in PR-01a) | `@swt-labs/core/methodology/` |
| `@swt-labs/verification` | preserve | `@swt-labs/core/verification/` |
| `@swt-labs/telemetry` | preserve | `@swt-labs/core/telemetry/` |
| `@swt-labs/dashboard-core` | fold | `@swt-labs/shared/schemas/` |
| `@swt-labs/cli` | preserve (dep-edge break in PR-01b) | unchanged |
| `@swt-labs/dashboard` | preserve | unchanged |
| `@swt-labs/codex-driver` | **DELETE** | (gone) |
| `@swt-labs/claude-code-driver` | **DELETE** | (gone) |
| `@swt-labs/ollama-driver` | **DELETE** | (gone) |

PR-05's delete is mechanical *after* PR-01a/b run.

### F-06 · 130 test files; 33 of them fail in v2.3.5 CI

`packages/**/test/**/*.test.ts` count = 130 (verified). Plus 2 root-level tests. v2.3.5's `ci.yml` has `continue-on-error: true` on `pnpm test` because of 33 pre-existing failures (documented as DEV-1D-class carryforward + Prettier-induced fixture drift).

M1 PR-11 is the gate that flips `continue-on-error: false`. It needs to first remediate or skip-with-tracking-issue the 33 failures. The recon could not enumerate which 33 — that's an M1 PR-11 deliverable.

### F-07 · `.nvmrc=20`; CI matrix adds Node 22

v2.3.5 default Node is `20` (verified in `.nvmrc`). CI matrix runs `[ubuntu-latest, macos-latest, windows-latest] × [20, 22]`. v3 keeps the same matrix.

### F-08 · CI test step blocking failures cluster locations

The 33 failures live in `packages/*/test/`; the exact locations are unaudited. Likely clusters (from TDD.md history + recon):

- `packages/methodology/test/` — DEV-1D-class state-machine tests
- Multiple packages — Prettier fixture drift (whitespace-sensitive expected outputs)

PR-11 includes a sub-step: audit `find packages -name "*.test.ts"`, run `pnpm test` to capture failures, classify each as `fixable` / `obsolete` / `skip-with-issue`, remediate the fixables and skip the rest with tracking issues.

## Relevant Patterns

### P-01 · The AgentSpawner pattern is already the abstraction seam

The `core/abstractions/AgentSpawner.ts` interface is the v2 design intent for methodology → spawn. v2 silently bypassed it via the direct `codex-driver/bootstrap.ts` import. The fix is to restore the intended pattern: methodology calls `AgentSpawner.spawn(...)`, concrete implementations live in `runtime/` (M1) and `orchestration/` (M3+).

### P-02 · Workspace-deps in `package.json` are evaluated independently of source imports

`packages/cli/package.json` lists `@swt-labs/claude-code-driver` and `@swt-labs/ollama-driver` as workspace deps without any matching `import` in source. These rows are dead — removing them is part of PR-05's `package.json` cleanup, not PR-01b's edge break.

### P-03 · Single binary published from root; CLI package internal

The published npm package is `stop-wasting-tokens`; the binary is `./dist/cli.mjs` from the root, bundled via `tsup` from `packages/cli/src/main.ts`. The `@swt-labs/cli` workspace package is private/internal — preserved at this location in v3 per TDD2§6.5.

### P-04 · Pnpm-lock churn cascades fast

The lockfile is 427KB. Any `package.json` edit that adds/removes deps triggers a regen. PR-01a/b each touch a `package.json` (methodology + cli) — they should also regenerate the lockfile in the same PR. PR-05 (driver deletion) and PR-02 (Pi peer-dep) trigger larger regens.

CI runs `--frozen-lockfile`; mismatched lockfile fails the install step. Discipline: every PR that touches deps regenerates and commits the lockfile in the same commit.

## Risks

### R-01 · Methodology test suite has hidden codex-spawner specifics (MEDIUM)

The fix in PR-01a relies on the AgentSpawner abstraction's mock being a drop-in replacement. If any `methodology/test/` file directly imports from `codex-driver` (not through the abstraction), the test fails after PR-01a. Mitigation: pre-audit `grep -r "codex-driver" packages/methodology/test/` before PR-01a; bundle the test rewrites in PR-01a's diff.

### R-02 · Pi peer-dep policy churns `pnpm-lock.yaml` significantly (LOW)

Adding `@earendil-works/pi-coding-agent` as peerDep across multiple packages will rewrite many lockfile entries. CI's `--frozen-lockfile` will fail unless lockfile is committed in the same PR. Mitigation: PR-02 commits the regenerated lockfile.

### R-03 · M1 PR-11 (CI test step required) could exceed its 3-day timebox (MEDIUM)

If the 33 failures cluster around state-machine carryforward bugs that need real fixes, remediation could take longer than budgeted. Mitigation per TDD2§13.1.6: time-box; if >3 days, scope down to "skip-with-tracking-issue" for the long-tail and gate with `--require-test-pass` flag in the meantime.

### R-04 · Driver deletion (PR-05) requires confidence that no external consumer uses them (LOW)

The three driver packages (`codex-driver`, `claude-code-driver`, `ollama-driver`) are workspace-internal — they're not published to npm. Verify with `git log --all -- packages/codex-driver/package.json | head -5` and check whether `publishConfig` exists. (Recon notes: no `publishConfig` in any driver's `package.json` — safe to delete.)

### R-05 · Windows-CI Node 20 matrix entry on v2.3.5 may be intermittent (LOW)

v2.3.5 ran the windows-Node-20 matrix entry. Some test files use POSIX-only file watchers that fail intermittently. PR-11 may surface these — handle as part of the 33-failure cleanup.

## Recommendations

### Rec-01 · Sequence M1 PRs strictly per TDD2§13.1.2

The TDD2 PR sequence is deliberate. Do not deviate. The order:

1. **PR-01a** — `methodology → codex-driver` edge break
2. **PR-01b** — `cli → codex-driver` edge break (introduces `SpawnerEnvironment`)
3. **PR-02** — `packages/runtime/` skeleton (peer-dep on Pi)
4. **PR-03** — `packages/orchestration/` skeleton
5. **PR-04** — `packages/shared/` (consolidates `core/types/` + `dashboard-core/schemas/`)
6. **PR-05** — delete `codex-driver`, `claude-code-driver`, `ollama-driver`
7. **PR-06** — cassette infrastructure
8. **PR-07** — token meter
9. **PR-08** — provider quirks scaffold
10. **PR-09** — first end-to-end (mocked Pi)
11. **PR-10** — docs pass
12. **PR-11** — CI test step required

Deviating risks landing Pi-dependent code before the edges are clean.

### Rec-02 · Treat PR-01a + PR-01b as the **entry gate** (non-negotiable)

Per TDD2§13.1.1, M1 cannot start until both PR-01a and PR-01b are merged. After both merge, run the grep invariant:

```bash
grep -rE "from '@swt-labs/(codex|claude-code|ollama)-driver'" packages/ \
  --exclude-dir={codex,claude-code,ollama}-driver
```

Must return nothing. If it returns anything, the entry gate has not been discharged.

### Rec-03 · Plans 01-01, 01-02, 01-03 — three plans for M1

With `max_tasks_per_plan=5` and 12 PRs, M1 needs three plans:

- **Plan 01-01:** PR-01a, PR-01b, PR-02, PR-03, PR-04 (entry gate + scaffolding)
- **Plan 01-02:** PR-05, PR-06, PR-07, PR-08, PR-09 (driver deletion + test infra + first e2e)
- **Plan 01-03:** PR-10, PR-11 (docs + CI test required)

This research feeds all three. Plan 01-01 is written in this `/vbw:vibe` invocation. Plans 01-02 and 01-03 follow on subsequent `/vbw:vibe` calls.

### Rec-04 · This planning workspace and the real SWT repo are separate

Plans authored here are *design artifacts*. The actual code changes for PR-01a, PR-01b, etc. land in `swt-labs/stop-wasting-tokens` (cloned at `.vbw-planning/research/swt-v2-source/` for reference, but that clone is read-only). The execution path for each plan:

1. Read the plan in this repo.
2. Switch to the real SWT repo working copy (a separate clone, *not* `.vbw-planning/research/swt-v2-source/`).
3. Execute the plan there (manually, or by initializing VBW in that repo and running `/vbw:vibe --execute`).

This separation is intentional — see ADR-013 (deferred) for whether to merge the planning workspace into the SWT repo or keep it standalone.
