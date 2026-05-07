#!/usr/bin/env bash
# post_qa — fires after contract QA writes VERIFICATION.md (regardless of
# PASS / PARTIAL / FAIL outcome). Useful for archiving the QA artifact,
# uploading it to a docs site, or notifying stakeholders.
#
# Env vars passed by SWT:
#   $SWT_PHASE          — phase number
#   $SWT_PHASE_SLUG     — phase slug
#   $SWT_QA_RESULT      — "PASS" / "PARTIAL" / "FAIL"
#   $SWT_QA_FAIL_COUNT  — number of FAIL rows (0 on PASS)
#   $SWT_VERIFICATION_FILE — relative path to the verification artifact
#
# Exit non-zero is observed but does not change phase routing.

printf 'post_qa: phase %s result=%s fail_count=%s file=%s\n' \
  "$SWT_PHASE" "$SWT_QA_RESULT" "$SWT_QA_FAIL_COUNT" "$SWT_VERIFICATION_FILE"
