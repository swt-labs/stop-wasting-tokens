#!/usr/bin/env bash
# post_phase — fires after a phase completes successfully (UAT 7/7 PASS or
# all_done routing). Receives the phase that just shipped.
#
# Env vars passed by SWT:
#   $SWT_PHASE       — phase number (e.g., "03")
#   $SWT_PHASE_SLUG  — phase slug (e.g., "03-multi-backend-drivers")
#   $SWT_PLAN_COUNT  — number of plans in the completed phase
#
# Use this hook to: post completion metrics, trigger downstream pipelines,
# update an external dashboard. Exit non-zero is observed but does not
# revert the phase completion.

printf 'post_phase: phase %s (%s) shipped — %s plans complete\n' "$SWT_PHASE" "$SWT_PHASE_SLUG" "$SWT_PLAN_COUNT"
