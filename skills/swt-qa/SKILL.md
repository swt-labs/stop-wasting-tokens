---
name: swt-qa
description: Goal-backward QA for a built SWT phase. Reads PLAN.md and SUMMARY.md, verifies each must-have, writes VERIFICATION.md. Use when the user wants to verify, QA, or check work that has been built. Triggered by "verify phase N", "swt qa", "run QA", "check my work", "is this done", "what passed".
---

# swt-qa

Goal-backward verification. The acceptance criteria are the contract — QA confirms each one.

## When to use

- A `.swt-planning/phases/<NN>-<slug>/<NN>-<MM>-SUMMARY.md` exists with `status: complete`.
- The user types something like "verify phase N", "swt qa", "run QA", "check my work", or "is this done".

## What this skill does

1. Reads PLAN.md (for must-haves) and SUMMARY.md (for what was actually built).
2. Picks the verification tier from config: `quick` (smoke + lint + types), `standard` (quick + unit tests + must-have evidence), or `deep` (standard + integration + cross-phase traceability).
3. Spawns the QA agent with the compiled context. The agent verifies each must-have and records concrete evidence.
4. Writes VERIFICATION.md with `result` (pass | fail | partial) and a check list.
5. Returns the result so the orchestrator can chain into UAT (when configured) or remediation (when checks fail).
