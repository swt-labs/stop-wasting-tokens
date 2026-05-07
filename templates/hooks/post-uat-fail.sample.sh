#!/usr/bin/env bash
# post_uat_fail — fires after a UAT round records issues (status: issues_found).
# Useful for paging on-call, raising a tracking ticket, or capturing
# additional context the moment failures are recorded.
#
# Env vars passed by SWT:
#   $SWT_PHASE         — phase number (e.g., "02")
#   $SWT_PHASE_SLUG    — phase slug
#   $SWT_UAT_ROUND     — UAT round number ("01" for first failure)
#   $SWT_ISSUE_COUNT   — number of issues recorded in this round
#   $SWT_UAT_FILE      — relative path to the UAT.md report
#
# Exit non-zero is observed but does not change UAT remediation routing.

printf 'post_uat_fail: phase %s round %s — %s issues in %s\n' \
  "$SWT_PHASE" "$SWT_UAT_ROUND" "$SWT_ISSUE_COUNT" "$SWT_UAT_FILE" >&2
