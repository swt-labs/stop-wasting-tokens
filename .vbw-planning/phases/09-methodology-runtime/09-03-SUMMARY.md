---
phase: 09
plan: 03
title: Bootstrap + Scope mode handlers (Phase 9 / PLAN 03)
status: complete
completed: 2026-05-06
tasks_completed: 12
tasks_total: 12
ac_results:
  - id: AC1
    must_have: TypeScript ports of VBW bootstrap-{project,requirements,roadmap,state,claude}.sh writers
    status: pass
    evidence: 'packages/artifacts/src/bootstrap/{project,requirements,roadmap,state,claude,context}.ts each export typed writer functions. project.ts: writeProject({name,description,core_value?}). requirements.ts: writeRequirements groups discovery into REQ-IDs by priority. roadmap.ts: writeRoadmap emits progress table + phase list + per-phase sections + Phase Anchor links. state.ts: writeState emits a fresh STATE.md with phase_count rendered. claude.ts: writeOrUpdateClaudeMd creates new or refreshes canonical sections (Active Context, VBW Rules, Plugin Isolation, Code Intelligence). context.ts: writePhaseContext + writeMilestoneContext.'
  - id: AC2
    must_have: 'discovery.json Zod schema + read/write helpers'
    status: pass
    evidence: 'packages/artifacts/src/bootstrap/discovery.ts exports DiscoverySchema (answered/inferred/deferred), readDiscovery (returns EMPTY_DISCOVERY when missing), writeDiscovery (writeAtomically). Round-trip test asserts shape preservation.'
  - id: AC3
    must_have: 'CONTEXT.md / MILESTONE-CONTEXT.md generators'
    status: pass
    evidence: 'context.ts writePhaseContext writes <planningDir>/phases/<NN>-<slug>/<NN>-CONTEXT.md with frontmatter (phase, gathered, pre_seeded) + Goal + Notes. writeMilestoneContext writes <planningDir>/CONTEXT.md with Scope Boundary, Decomposition Decisions, Requirement Mapping, Key Decisions, Deferred Ideas.'
  - id: AC4
    must_have: 'Bootstrap mode handler that composes the writers and replaces the stub'
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/bootstrap.ts exports bootstrapHandler. Args path reads .swt-planning/bootstrap-input.json ({project_name, description, core_value?}); on success runs writeProject + writeDiscovery + writeRequirements + writeRoadmap (empty phases) + writeState (phase_count=0) + writeOrUpdateClaudeMd. Returns HandlerResult{exit:0, ranTo:completion}. Without input it throws NotImplementedError pointing at PLAN 03b. CLI registers it via buildVibeRegistry([bootstrapHandler(), scopeHandler()]).'
  - id: AC5
    must_have: 'Scope mode handler that consumes a phases payload'
    status: pass
    evidence: 'packages/methodology/src/vibe/handlers/scope.ts exports scopeHandler. Reads .swt-planning/phases.json validated via ScopeInputSchema (project_name, milestone_name, scope_boundary, decomposition_rationale, phases[]). Creates phase dirs + per-phase CONTEXT.md, writes ROADMAP/STATE/CONTEXT. Replaces the stub.'
  - id: AC6
    must_have: 'CLAUDE.md generator preserves user content'
    status: pass
    evidence: 'claude.ts writeOrUpdateClaudeMd parses existing CLAUDE.md sections, refreshes only Active Context / VBW Rules / Plugin Isolation in place, preserves user-authored sections verbatim, and adds Code Intelligence only when no equivalent guidance is detected (regex match on goToDefinition / findReferences / "## Code Intelligence" / LSP-first). Test claude.test.ts asserts the preserve-existing path keeps "## Build commands" + body intact and overwrites "## Active Context" body.'
  - id: AC7
    must_have: 'Vitest covers each writer round-tripped against a temp dir, plus the two mode handlers'
    status: pass
    evidence: 'artifacts/test/bootstrap/{discovery,writers,claude}.test.ts cover discovery round-trip + writeProject + writeRequirements (with REQ-ID numbering) + writeRoadmap (progress table + phase sections) + writeState (with phase_count) + writePhaseContext + writeMilestoneContext + claude preserve-existing + Code Intelligence skip. methodology/test/vibe/handlers/{bootstrap,scope}.test.ts run handlers end-to-end against temp dirs and assert the resulting tree.'
commit_hashes:
  - 26e30d2
files_modified:
  - packages/artifacts/src/index.ts
  - packages/artifacts/src/bootstrap/index.ts
  - packages/artifacts/src/bootstrap/discovery.ts
  - packages/artifacts/src/bootstrap/project.ts
  - packages/artifacts/src/bootstrap/requirements.ts
  - packages/artifacts/src/bootstrap/roadmap.ts
  - packages/artifacts/src/bootstrap/state.ts
  - packages/artifacts/src/bootstrap/claude.ts
  - packages/artifacts/src/bootstrap/context.ts
  - packages/artifacts/test/bootstrap/discovery.test.ts
  - packages/artifacts/test/bootstrap/writers.test.ts
  - packages/artifacts/test/bootstrap/claude.test.ts
  - packages/methodology/src/vibe/index.ts
  - packages/methodology/src/vibe/handlers/stubs.ts
  - packages/methodology/src/vibe/handlers/bootstrap.ts
  - packages/methodology/src/vibe/handlers/scope.ts
  - packages/methodology/test/vibe/handlers/bootstrap.test.ts
  - packages/methodology/test/vibe/handlers/scope.test.ts
  - packages/cli/src/commands/vibe.ts
deviations:
  - id: D1
    type: scope
    description: 'Interactive bootstrap (without bootstrap-input.json) and interactive scope (without phases.json) throw NotImplementedError pointing at PLAN 03b. The Discussion engine port is the right place to add the calibrate / gray-area / capture protocol that drives those interactive paths.'
    resolution: 'PLAN 03b: Discussion engine. Until then, users place a JSON payload at .swt-planning/{bootstrap-input,phases}.json and re-run.'
  - id: D2
    type: scope
    description: 'Auto phase decomposition (requirements → suggested phases) is not implemented. Today the user supplies the phases array.'
    resolution: 'Will land with the Discussion engine when the scope-mode interactive flow is built.'
  - id: D3
    type: process
    description: 'pnpm not installed locally; tests not run this session.'
    resolution: 'GitHub Actions CI matrix validates on push/PR.'
deferred_to_followup:
  - 'PLAN 03b: Discussion engine — calibrate, gray-area generation, capture into discovery.json + CONTEXT.md, plus Prompter abstraction so the same engine works in tests, terminal, and (future) Codex prompt UI.'
  - 'PLAN 04: Plan + Execute orchestration — Scout/Lead spawn for planning, wave-driven Dev fan-out, Dev/QA chaining.'
  - 'PLAN 05: QA + UAT remediation pipelines.'
  - 'PLAN 06: Verify mode + Milestone UAT recovery.'
  - 'PLAN 07: Archive + 7-point audit gate.'
---

# Phase 9 / Plan 03 Summary: Bootstrap + Scope mode handlers

## What Was Built

Two of VBW's input-side modes are no longer stubs:

- **`@swt-labs/artifacts/bootstrap/`** — TypeScript ports of every VBW `bootstrap-*.sh` writer plus `discovery.json` round-trip and the per-phase + milestone CONTEXT.md generators.
- **`bootstrapHandler`** — composes the writers from a JSON input file. Without input it throws NotImplementedError pointing at PLAN 03b (interactive engine).
- **`scopeHandler`** — same shape; consumes `phases.json` to write ROADMAP + STATE + per-phase CONTEXTs + milestone CONTEXT.
- **`buildVibeRegistry(realHandlers)`** — composition factory that lets real handlers override stubs. CLI registers `[bootstrapHandler(), scopeHandler()]` today.
- **CLAUDE.md preservation** — writeOrUpdateClaudeMd refreshes canonical sections only; user content is preserved verbatim. Code Intelligence is added only when no equivalent guidance already exists.

## Files Modified

See `files_modified` in frontmatter (19 files).

## Acceptance criteria status

All 7 must-haves pass. Three deviations recorded — interactive paths deferred to PLAN 03b (D1), auto-decomposition deferred (D2), local pnpm smoke run unavailable (D3).

## Commit

`26e30d2` — feat(methodology): bootstrap + scope mode handlers (Phase 9 / PLAN 03)
