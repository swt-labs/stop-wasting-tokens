---
name: swt-debug
description: Investigate failing tests, broken builds, or recurring UAT issues with the Debugger agent. Generates 2-4 hypotheses, tests them with evidence, and proposes a precise fix. Use when something is broken, a fix did not stick, or the same issue keeps recurring. Triggered by "debug this", "swt debug", "why is this failing", "the test is broken", "this keeps coming back".
---

# swt-debug

Hypothesis-driven debugging using the highest-effort role.

## When to use

- A test, build, or UAT step is failing.
- A previous fix did not actually resolve the symptom.
- The same UAT issue has been reopened in two or more remediation rounds.
- The user types something like "debug this", "swt debug", "why is this failing", or "this keeps coming back".

## What this skill does

1. Reads the failing artefact (test output, build log, UAT report) verbatim.
2. Spawns the Debugger agent with explicit instructions to form 2-4 hypotheses BEFORE running anything.
3. The Debugger tests the most likely hypothesis first, captures evidence for and against, and writes `DEBUG-SESSION.md`.
4. If the issue is recurring, the Debugger explicitly examines why prior fixes did not stick.
5. Hands the proposed fix (precise diff + rationale) back to the Dev agent for implementation.
