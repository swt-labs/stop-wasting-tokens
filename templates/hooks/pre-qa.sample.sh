#!/usr/bin/env bash
# pre_qa — fires before contract QA writes a phase-level VERIFICATION.md.
# Useful for last-mile environment setup (e.g., spinning up an integration
# database, refreshing a fixture set) that should happen between phase
# execution and QA verification.
#
# Env vars passed by SWT:
#   $SWT_PHASE       — phase number
#   $SWT_PHASE_SLUG  — phase slug
#   $SWT_PLAN_COUNT  — number of plans being verified
#
# Exit non-zero to abort QA. The phase remains in needs_verification state
# until the next `swt vibe` invocation.

printf 'pre_qa: starting QA for phase %s (%s plans)\n' "$SWT_PHASE" "$SWT_PLAN_COUNT"
