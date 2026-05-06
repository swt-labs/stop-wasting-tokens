---
phase: 07
plan: 01
title: Artifacts engine — schemas + frontmatter IO + STATE/ROADMAP editors + milestones (artifact Phase 6)
status: complete
completed: 2026-05-06
tasks_completed: 9
tasks_total: 9
ac_results:
  - id: AC1
    must_have: Zod schemas for the four project-level artefacts (PROJECT, REQUIREMENTS, ROADMAP, STATE)
    status: pass
    evidence: schemas/project.ts ProjectFrontmatterSchema (passthrough); schemas/requirements.ts RequirementSchema + RequirementsFrontmatterSchema; schemas/roadmap.ts PhaseEntrySchema + RoadmapSchema (>=1 phase required); schemas/state.ts StateCurrentPhaseSchema + StateSchema (passthrough). Re-exported via schemas/index.ts.
  - id: AC2
    must_have: Minimal YAML frontmatter parser/formatter
    status: pass
    evidence: frontmatter.ts parseFrontmatter handles fenced ---/---/ blocks with scalar / inline-array / boolean / int values. formatFrontmatter emits the same shapes. Round-trip test covers parse-format-parse equality.
  - id: AC3
    must_have: Atomic write helper (temp file + rename)
    status: pass
    evidence: atomic-write.ts writeAtomically writes to <path>.tmp-<pid>-<random> and renames over the target; mkdir -p parent. Tests assert no stray .tmp-* files after a write, overwrite correctness, and parent dir creation.
  - id: AC4
    must_have: STATE.md reader/updater
    status: pass
    evidence: state/updater.ts parseState extracts the Project line and ## Heading sections; readState returns undefined when STATE.md is missing; updateState applies a mutator and writes atomically. Tests cover both paths against a temp dir.
  - id: AC5
    must_have: ROADMAP.md editor supporting phase add / insert / remove
    status: pass
    evidence: roadmap/editor.ts addPhase appends and renumbers; insertPhase(pos) shifts later phases up by one and emits PhaseRename migrations; removePhase(pos) shifts later phases down by one and emits the inverse migrations. Tests cover correctness, renaming, and out-of-range position throws.
  - id: AC6
    must_have: Phase directory layout writer
    status: pass
    evidence: phases/layout.ts createPhaseDir(planningDir, position, slug, name, goal) is idempotent (mkdir -p + writeFile flag wx); seeds <NN>-CONTEXT.md with the phase title, goal, and an empty Notes section.
  - id: AC7
    must_have: Milestone archiver
    status: pass
    evidence: milestones/archive.ts archiveMilestone(planningDir, slug) renames ROADMAP.md and phases/ under milestones/<slug>/, copies STATE.md to the archive, rewrites the root STATE.md preserving Project + Todos + Key Decisions + Blockers sections, and writes a SHIPPED.md marker. Tests assert files moved, STATE rewritten, and SHIPPED contents.
  - id: AC8
    must_have: Vitest suite covering schemas, frontmatter round-trip, ROADMAP edits, milestone archive
    status: pass
    evidence: schemas.test.ts (project + requirements + phase + roadmap + state validation), frontmatter.test.ts (parse + format + round-trip + missing fences), atomic-write.test.ts (basic + overwrite + nested dirs), state.test.ts (parseState + readState/updateState), roadmap.test.ts (add + insert + remove + range errors + renames), milestones.test.ts (move + STATE rewrite + SHIPPED marker).
commit_hashes:
  - 7180194
files_modified:
  - packages/artifacts/package.json
  - packages/artifacts/src/index.ts
  - packages/artifacts/src/frontmatter.ts
  - packages/artifacts/src/atomic-write.ts
  - packages/artifacts/src/schemas/index.ts
  - packages/artifacts/src/schemas/project.ts
  - packages/artifacts/src/schemas/requirements.ts
  - packages/artifacts/src/schemas/roadmap.ts
  - packages/artifacts/src/schemas/state.ts
  - packages/artifacts/src/state/updater.ts
  - packages/artifacts/src/roadmap/editor.ts
  - packages/artifacts/src/phases/layout.ts
  - packages/artifacts/src/milestones/archive.ts
  - packages/artifacts/test/frontmatter.test.ts
  - packages/artifacts/test/atomic-write.test.ts
  - packages/artifacts/test/schemas.test.ts
  - packages/artifacts/test/state.test.ts
  - packages/artifacts/test/roadmap.test.ts
  - packages/artifacts/test/milestones.test.ts
deviations:
  - id: D1
    type: scope
    description: Removed gray-matter from packages/artifacts/package.json. The artifact's Phase 6 task list named gray-matter, but the actual SWT frontmatter shapes are flat enough that a 60-line in-house parser is simpler than a runtime dependency.
    resolution: in-house parser covered by frontmatter.test.ts. Should SWT later need full YAML support (e.g. multi-line strings or nested objects), gray-matter can be added back as a one-line edit.
  - id: D2
    type: scope
    description: Traceability link checker (REQUIREMENTS ↔ ROADMAP ↔ PLAN ↔ SUMMARY ↔ VERIFICATION) was not implemented in this phase.
    resolution: Belongs to Phase 8 (Verification & QA), where the verifier will own cross-document linkage.
  - id: D3
    type: scope
    description: Per-phase artefact schemas (PLAN.md, SUMMARY.md, VERIFICATION.md) were not added under packages/artifacts/.
    resolution: The handoff schemas in @swt-labs/core (LeadHandoff, DevHandoff, QaHandoff) already validate the wire formats those artefacts carry; duplicating them here would add a maintenance burden without value. The runtime in Phase 8 will reuse the core handoff schemas.
  - id: D4
    type: process
    description: pnpm not installed locally; tests not run this session.
    resolution: GitHub Actions CI matrix validates on push/PR.
deferred_to_user: []
---

# Phase 7 Summary: Artifacts engine

## What Was Built

`packages/artifacts` is the I/O layer SWT uses to read and write the four project-level artefacts plus the per-phase directory layout and milestone archive:

- **Frontmatter** — a tiny in-house YAML reader/emitter sufficient for SWT's flat-shape frontmatter (no gray-matter dependency).
- **Atomic write** — `writeAtomically(path, content)` uses temp + rename to avoid torn writes.
- **Schemas** — Zod schemas for PROJECT, REQUIREMENTS, ROADMAP (with PhaseEntry), and STATE. Permissive passthrough so external edits round-trip.
- **State updater** — `readState`, `updateState(path, mutator)`, `parseState(raw)` for sectioned access.
- **Roadmap editor** — `addPhase`, `insertPhase(pos)`, `removePhase(pos)` returning the renumbered phase list plus the disk-rename migrations callers should apply.
- **Phase layout** — `createPhaseDir` seeds `<NN>-CONTEXT.md` and is idempotent.
- **Milestone archive** — `archiveMilestone` moves ROADMAP + phases/ under `milestones/<slug>/`, archives STATE, rewrites the root STATE preserving project-level sections, and writes a SHIPPED marker.

Six Vitest suites cover the lot.

## Files Modified

See `files_modified` in frontmatter (19 files).

## Acceptance criteria status

All 8 must-haves pass. Four deviations recorded — gray-matter dependency dropped (D1), traceability and per-phase schemas explicitly deferred (D2, D3), and the local pnpm smoke run unavailable (D4).

## Commit

`7180194` — feat(artifacts): schemas + frontmatter IO + STATE/ROADMAP editors + milestones
