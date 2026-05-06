---
phase: "03"
plan: "02"
title: "Sample VBW-grade plan"
wave: 2
depends_on: ["03-01"]
must_haves: [{"truths":["The orchestrator runs Lead before Dev"],"artifacts":["packages/methodology/src/vibe/handlers/plan.ts"],"key_links":["docs/orchestration.md"]}, "Light requirement that ships as a string"]
cross_phase_deps: ["02-01"]
effort_override: thorough
forbidden_commands: ["rm -rf", "git push --force"]
skills_used: ["vbw:vibe-orchestration"]
files_modified: ["packages/methodology/src/vibe/handlers/plan.ts"]
---

# Phase 3 / Plan 02

Body content goes here.
