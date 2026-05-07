#!/usr/bin/env bash
# pre_archive — fires before `swt vibe --archive` moves a milestone from
# .swt-planning/ to .swt-planning/milestones/{slug}/.
#
# Env vars passed by SWT:
#   $SWT_MILESTONE_SLUG   — the slug being archived
#   $SWT_PHASE_COUNT      — number of phases in the milestone
#   $SWT_TAG              — git tag selected for the archive (or empty)
#
# Use this hook to: stage release notes, run final lint sweeps, post a
# Slack notification, etc. Exit non-zero to abort the archive.

printf 'pre_archive: archiving milestone %s with %s phases\n' "$SWT_MILESTONE_SLUG" "$SWT_PHASE_COUNT"
