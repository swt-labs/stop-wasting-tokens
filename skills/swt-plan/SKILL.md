---
name: swt-plan
description: Plan the next SWT phase. Spawns Scout for research and Lead for the actual PLAN.md, splitting work into waves with explicit dependencies. Use when the user wants to plan a phase, decompose a goal into tasks, or write a PLAN.md. Triggered by "plan phase N", "swt plan", "decompose this", "break this into waves", "what should we do next".
---

# swt-plan

This skill plans a single SWT phase end to end.

## When to use

- A `.swt-planning/phases/<NN>-<slug>/` directory exists with no `PLAN.md`.
- The user types something like "plan phase N", "swt plan", "decompose this", or "break this into waves".

## What this skill does

1. Reads the phase goal from ROADMAP.md and any existing CONTEXT.md.
2. Spawns the Scout to write RESEARCH.md (skipped on `effort=turbo`).
3. Spawns the Lead to write PLAN.md based on the goal, the research, and the project's REQUIREMENTS.md.
4. Validates that wave membership is sound — same-wave plans must modify disjoint files.
5. Surfaces the plan to the user with task counts, must-haves, and the next action.

Plans always include explicit acceptance criteria so the QA agent can verify them later.
