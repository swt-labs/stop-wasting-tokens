---
phase: 03
plan: 01
title: Core abstractions — types, handoff schemas, four interfaces, errors, Config (artifact Phase 2)
status: complete
completed: 2026-05-06
tasks_completed: 8
tasks_total: 8
ac_results:
  - id: AC1
    must_have: packages/core exports the three core enum types (effort, autonomy, verification tiers)
    status: pass
    evidence: packages/core/src/types/{effort,autonomy,verification,agent-role}.ts each export the literal-union type, a const array, and an `isX` guard. Re-exported through types/index.ts and the package barrel.
  - id: AC2
    must_have: packages/core/src/handoff exports five Zod-validated handoff schemas plus a generic handoff_envelope wrapper
    status: pass
    evidence: handoff/envelope.ts exports HandoffEnvelopeSchema with from/to/kind/payload/metadata; handoff/{scout,architect,lead,dev,qa}.ts each extend it with a literal `kind` and a typed payload schema, plus a parseX helper that throws HandoffError on rejection.
  - id: AC3
    must_have: packages/core/src/abstractions exports four typed interfaces with no backend-specific leakage
    status: pass
    evidence: HookHost (HookEvent union, HookContext, HookHandler, HookSubscription, dispatch, flush), AgentSpawner (AgentSpec, SpawnRequest, SpawnResult), PermissionGate (SandboxMode, ApprovalPolicy, PermissionProfile, evaluate), MemoryStore (MemoryEntry, MemoryQuery, put/get/query/remove/compact). All are pure type contracts with no Codex-specific imports.
  - id: AC4
    must_have: packages/core/src/config exports a Zod-validated Config schema
    status: pass
    evidence: config/Config.ts exports ConfigSchema with .default() per key, parseConfig (throws ConfigError on rejection), DEFAULT_CONFIG (parsed defaults), and SwtConfig type (z.infer).
  - id: AC5
    must_have: packages/core/src/errors exports a typed error hierarchy rooted at SwtError
    status: pass
    evidence: SwtError abstract base with literal SwtErrorCode discriminant; ConfigError, HandoffError, PermissionDeniedError, MemoryError, BackendError subclasses each set their own code. Includes toJSON, isSwtError, formatCause helpers.
  - id: AC6
    must_have: packages/core/test contains a mock backend driver implementing all four interfaces
    status: pass
    evidence: test/mock-driver.ts exports MockHookHost (in-memory subscription map with short-circuit on block), MockAgentSpawner (records spawned requests), MockPermissionGate (read-only profile enforcement), MockMemoryStore (in-memory entries with topic/tag filters).
  - id: AC7
    must_have: Vitest tests cover schema parse/validate, profile preset resolution, and error formatting
    status: pass
    evidence: handoff.test.ts (8 cases — round-trips for all five schemas + rejection cases), config.test.ts (defaults, partial overrides, invalid effort/autonomy rejection, agent_max_turns override), errors.test.ts (instanceof narrowing, code preservation, toJSON shape, formatCause), mock-driver.test.ts (HookHost dispatch + blocking, AgentSpawner install/spawn, PermissionGate read-only enforcement, MemoryStore round-trip).
commit_hashes:
  - 13dffea
files_modified:
  - packages/core/src/index.ts
  - packages/core/src/types/effort.ts
  - packages/core/src/types/autonomy.ts
  - packages/core/src/types/verification.ts
  - packages/core/src/types/agent-role.ts
  - packages/core/src/types/index.ts
  - packages/core/src/handoff/envelope.ts
  - packages/core/src/handoff/scout.ts
  - packages/core/src/handoff/architect.ts
  - packages/core/src/handoff/lead.ts
  - packages/core/src/handoff/dev.ts
  - packages/core/src/handoff/qa.ts
  - packages/core/src/handoff/index.ts
  - packages/core/src/abstractions/HookHost.ts
  - packages/core/src/abstractions/AgentSpawner.ts
  - packages/core/src/abstractions/PermissionGate.ts
  - packages/core/src/abstractions/MemoryStore.ts
  - packages/core/src/abstractions/index.ts
  - packages/core/src/config/Config.ts
  - packages/core/src/config/index.ts
  - packages/core/src/errors/SwtError.ts
  - packages/core/src/errors/index.ts
  - packages/core/test/mock-driver.ts
  - packages/core/test/handoff.test.ts
  - packages/core/test/config.test.ts
  - packages/core/test/errors.test.ts
  - packages/core/test/mock-driver.test.ts
deviations:
  - id: D1
    type: process
    description: pnpm is not installed on this machine, so `pnpm --filter @swt-labs/core typecheck` and `pnpm test` were not executed locally during Phase 3.
    resolution: GitHub Actions CI matrix (Node 20/22 × Linux/macOS/Windows) runs both on every push/PR. If a typecheck issue surfaces in CI, fix it as a follow-up `chore(core): typecheck fix` commit.
deferred_to_user: []
---

# Phase 3 Summary: Core abstractions

## What Was Built

`packages/core` is now the typed contract layer the rest of the codebase depends on. It ships four files of types, six files of Zod-validated handoff schemas, four backend-agnostic interfaces, a typed error hierarchy, a Zod config schema with defaults, and a complete in-memory mock backend driver paired with a Vitest suite.

Everything is pure types and pure data — no I/O, no backend coupling. Phase 4 (Codex backend driver) and beyond will implement these interfaces against real backends.

## Files Modified

See `files_modified` in frontmatter (27 files).

## Acceptance criteria status

All 7 must-haves pass. One deviation (D1) recorded — local pnpm not installed; CI will validate.

## Commit

`13dffea` — feat(core): add types, handoff schemas, four abstractions, config, errors
