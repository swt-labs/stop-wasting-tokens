#!/usr/bin/env bash
# pre_phase — fires before a phase starts (right after routing decides the
# phase is needs_discussion / needs_plan_and_execute / needs_execute).
#
# Env vars passed by SWT:
#   $SWT_PHASE       — phase number (e.g., "04")
#   $SWT_PHASE_SLUG  — phase slug (e.g., "04-user-surfaces")
#   $SWT_PHASE_STATE — the routed state (needs_discussion etc.)
#
# Use this hook to: preflight environment checks, validate prereqs, refresh
# auxiliary state. Exit non-zero to abort the phase before any agent spawns.

printf 'pre_phase: starting phase %s (%s) state=%s\n' "$SWT_PHASE" "$SWT_PHASE_SLUG" "$SWT_PHASE_STATE"
