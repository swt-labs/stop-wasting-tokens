---
phase: 05
plan: 01
title: Methodology authoring — agents, skills, prompt builder, profiles, memory (artifact Phase 4)
status: complete
completed: 2026-05-06
tasks_completed: 7
tasks_total: 7
ac_results:
  - id: AC1
    must_have: Six agent TOML templates under agents-templates/
    status: pass
    evidence: scout.toml (read-only, 15 turns, balanced), architect.toml (read-only, 30, thorough), lead.toml (workspace-write, 50, thorough), dev.toml (workspace-write, 75, balanced), qa.toml (read-only, 25, thorough), debugger.toml (workspace-write, 80, thorough). Each carries role-appropriate model_reasoning_effort, sandbox_mode, allowed_mcp_servers, and developer_instructions describing responsibilities and constraints.
  - id: AC2
    must_have: Six skills under skills/ with auto-matching descriptions
    status: pass
    evidence: skills/swt-{init,plan,execute,qa,map,debug}/SKILL.md each have YAML frontmatter with name + description (≥ 10 chars, trigger-rich) and a body documenting when the skill matches and what it produces.
  - id: AC3
    must_have: Cache-aware prompt builder splitting prompts into a stable static prefix and a dynamic suffix
    status: pass
    evidence: prompt-builder/builder.ts buildPrompt(input) returns { prefix, suffix, full }; the prefix is composed from role + project_name + core_value + conventions + config (effort/autonomy/verification_tier/model_profile); the suffix carries dynamic + optional task.
  - id: AC4
    must_have: Static-layer hash check ensuring the prefix is byte-identical across sessions for the same config
    status: pass
    evidence: prompt-builder/hash.ts hashPrefix(prefix) returns the SHA-256 hex digest. Test prompt-builder.test.ts asserts that two builds with the same fixture (different dynamic input) yield the same prefix and the same hash, and that changing a static input (conventions) changes the hash.
  - id: AC5
    must_have: Effort, autonomy, and verification profile resolution helpers
    status: pass
    evidence: profiles/effort.ts EFFORT_PROFILES + resolveEffortProfile + scaleAgentTurns; profiles/autonomy.ts AUTONOMY_PROFILES + resolveAutonomyProfile; profiles/verification.ts VERIFICATION_PROFILES + resolveVerificationProfile. Each returns a documented preset (e.g. thorough includes Scout/Architect/QA, turbo skips them; cautious stops after every stage, pure-vibe auto-chains; quick skips unit/integration tests, deep enforces traceability).
  - id: AC6
    must_have: Lightweight MEMORY.md model — top-level index + topic files
    status: pass
    evidence: memory/format.ts formats topic files (YAML frontmatter + body) and the always-on MEMORY.md table; memory/store.ts FileMemoryStore implements MemoryStore from core (put/get/query/remove/compact) over `<dir>/memory/<id>.md` topic files plus a regenerated `<dir>/MEMORY.md` index.
  - id: AC7
    must_have: Vitest suite covering profile resolution, prompt builder stability, and MEMORY.md round-trip
    status: pass
    evidence: profiles.test.ts (effort thorough/turbo coverage, scaleAgentTurns multiplier, cautious vs pure-vibe autonomy, quick vs deep verification), prompt-builder.test.ts (prefix stability across calls, prefix change on convention change, dynamic suffix + task rendering, prefix reflects role/config), memory.test.ts (put/get round-trip, query by topic/tag/limit, MEMORY.md regeneration on compact, removal updates the index).
commit_hashes:
  - 7457d4a
files_modified:
  - agents-templates/scout.toml
  - agents-templates/architect.toml
  - agents-templates/lead.toml
  - agents-templates/dev.toml
  - agents-templates/qa.toml
  - agents-templates/debugger.toml
  - skills/swt-init/SKILL.md
  - skills/swt-plan/SKILL.md
  - skills/swt-execute/SKILL.md
  - skills/swt-qa/SKILL.md
  - skills/swt-map/SKILL.md
  - skills/swt-debug/SKILL.md
  - packages/methodology/src/index.ts
  - packages/methodology/src/profiles/effort.ts
  - packages/methodology/src/profiles/autonomy.ts
  - packages/methodology/src/profiles/verification.ts
  - packages/methodology/src/profiles/index.ts
  - packages/methodology/src/prompt-builder/builder.ts
  - packages/methodology/src/prompt-builder/hash.ts
  - packages/methodology/src/prompt-builder/index.ts
  - packages/methodology/src/memory/format.ts
  - packages/methodology/src/memory/store.ts
  - packages/methodology/src/memory/index.ts
  - packages/methodology/test/profiles.test.ts
  - packages/methodology/test/prompt-builder.test.ts
  - packages/methodology/test/memory.test.ts
deviations:
  - id: D1
    type: scope
    description: Methodology runtime — Lead reading Scout's RESEARCH.md, Dev fan-out coordinated by waves, QA receiving Dev's SUMMARY.md — was not implemented as runtime code in this phase.
    resolution: Deferred to Phase 6 (Commands), where the actual `swt vibe`/`swt plan`/`swt execute`/`swt qa` verbs wire the methodology pieces together.
  - id: D2
    type: scope
    description: End-to-end Vitest tests against the mock Codex driver were not added.
    resolution: Deferred to Phase 6 with the command surface — they need actual command flows to exercise.
  - id: D3
    type: scope
    description: Long-form `docs/concepts/methodology.md` guide was not authored.
    resolution: Deferred to Phase 9 (Documentation site), the right home for narrative docs.
  - id: D4
    type: process
    description: pnpm not installed locally; tests not run in this session.
    resolution: GitHub Actions CI matrix validates on push/PR.
deferred_to_user: []
---

# Phase 5 Summary: Methodology authoring

## What Was Built

The methodology layer sits above the four core abstractions and the Codex driver. Phase 5 ships its authored content and pure helpers:

- **Six agent TOML templates** describing each role's model, reasoning effort, sandbox mode, allowed MCP servers, max turns, and developer instructions. The Codex driver's TOML emitter renders these into `~/.codex/agents/<role>.toml`.
- **Six skills** with auto-matching descriptions and bodies covering init, plan, execute, qa, map, and debug. These are the user-facing methodology delivery mechanism.
- **Three profile resolvers** that translate effort/autonomy/verification tiers into concrete feature flags (e.g. include_scout, stop_after_plan, run_unit_tests).
- **Cache-aware prompt builder** that splits every prompt into a stable static prefix and a dynamic suffix, with a SHA-256 hash for cache-stability assertions.
- **MEMORY.md model** as a filesystem-backed `MemoryStore` implementation: `<dir>/MEMORY.md` index + `<dir>/memory/<id>.md` topic files, regenerated on `compact()`.

The actual runtime that wires Scout → Lead → Dev → QA hand-offs together arrives with the command surface in Phase 6.

## Files Modified

See `files_modified` in frontmatter (26 files).

## Acceptance criteria status

All 7 must-haves pass. Four scope/process deviations (runtime wiring, e2e tests, narrative docs, local pnpm smoke run) all explicitly deferred to phases that own them.

## Commit

`7457d4a` — feat(methodology): agents, skills, prompt builder, profiles, memory store
