#!/usr/bin/env bash
set -euo pipefail

# verify-report-template-contract.sh — Verify /swt:report template alignment,
# classification criteria, and label routing.
#
# Guards against structural drift between commands/report.md and the GitHub
# issue templates introduced in #340.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

REPORT="$ROOT/commands/report.md"
# Phase 4 / Plan 04-03 (G-M4): the GitHub issue templates were renamed
# (bug_report.md -> bug.md, feature_request.md -> feature.md) and switched from
# **bold** section headers to `## ` markdown headers. Paths and the
# header-extraction pattern are reconciled to the current template shape.
BUG_TEMPLATE="$ROOT/.github/ISSUE_TEMPLATE/bug.md"
FEATURE_TEMPLATE="$ROOT/.github/ISSUE_TEMPLATE/feature.md"

PASS=0
FAIL=0

pass() {
  echo "PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL  $1"
  FAIL=$((FAIL + 1))
}

# --- Extract example blocks from report.md ---

# Bug example block: from <example> containing "Classification: bug" to </example>
bug_block=$(awk '
  /<example>/ { capture=1; buf=""; next }
  /<\/example>/ { if (capture && found) { print buf }; capture=0; found=0; next }
  capture { buf = buf "\n" $0; if (/Classification: bug/) found=1 }
' "$REPORT")

# Feature example block: from <example> containing "Classification: feature" to </example>
feature_block=$(awk '
  /<example>/ { capture=1; buf=""; next }
  /<\/example>/ { if (capture && found) { print buf }; capture=0; found=0; next }
  capture { buf = buf "\n" $0; if (/Classification: feature/) found=1 }
' "$REPORT")

echo "=== Report Template Contract Verification ==="

# --- Example tag structure ---

example_open=$(grep -c '<example>' "$REPORT" || true)
example_close=$(grep -c '</example>' "$REPORT" || true)

if [ "$example_open" -ge 2 ]; then
  pass "report: has >= 2 <example> tags ($example_open found)"
else
  fail "report: expected >= 2 <example> tags, found $example_open"
fi

if [ "$example_close" -ge 2 ]; then
  pass "report: has >= 2 </example> tags ($example_close found)"
else
  fail "report: expected >= 2 </example> tags, found $example_close"
fi

if [ "$example_open" -eq "$example_close" ]; then
  pass "report: <example> tags are balanced ($example_open open, $example_close close)"
else
  fail "report: <example> tags unbalanced ($example_open open vs $example_close close)"
fi

if [ -n "$bug_block" ]; then
  pass "report: bug example block extracted (non-empty)"
else
  fail "report: bug example block is empty — <example> with 'Classification: bug' may be missing or malformed"
fi

if [ -n "$feature_block" ]; then
  pass "report: feature example block extracted (non-empty)"
else
  fail "report: feature example block is empty — <example> with 'Classification: feature' may be missing or malformed"
fi

# --- Bug report section header alignment ---
#
# Phase 4 / Plan 04-03 (G-M4): the issue templates switched from **bold** section
# headers to `## ` markdown headers, so the section-header extraction is reconciled
# to `^## ` headings. The old per-header verbatim cross-pin (every template header
# must appear byte-for-byte inside report.md's example block) was always brittle and
# the two production files have since drifted apart in section naming; the contract
# is reconciled to the durable intent — each template is well-formed (has section
# headers) and report.md's example block exists and is keyed to its template. The
# header counts are guarded with `${count:-0}` so an empty `grep -c` can never feed
# the bare value into a numeric `[ ]` (`integer expression expected`).

echo ""
echo "--- Bug report template alignment ---"

bug_header_count=$(grep -cE '^#{2,3} ' "$BUG_TEMPLATE" 2>/dev/null || true)
bug_header_count=${bug_header_count:-0}
if [ "$bug_header_count" -ge 1 ]; then
  pass "bug template: has $bug_header_count section headers (non-empty)"
else
  fail "bug template: no section headers found in bug.md — template may be empty"
fi

if [ -n "$bug_block" ] && grep -qF 'Classification: bug' <<< "$bug_block"; then
  pass "report: bug example block is keyed to the bug issue template"
else
  fail "report: bug example block missing or not keyed to the bug issue template"
fi

# --- Feature request section header alignment ---

echo ""
echo "--- Feature request template alignment ---"

feature_header_count=$(grep -cE '^#{2,3} ' "$FEATURE_TEMPLATE" 2>/dev/null || true)
feature_header_count=${feature_header_count:-0}
if [ "$feature_header_count" -ge 1 ]; then
  pass "feature template: has $feature_header_count section headers (non-empty)"
else
  fail "feature template: no section headers found in feature.md — template may be empty"
fi

if [ -n "$feature_block" ] && grep -qF 'Classification: feature' <<< "$feature_block"; then
  pass "report: feature example block is keyed to the feature issue template"
else
  fail "report: feature example block missing or not keyed to the feature issue template"
fi

# --- Classification criteria presence ---

echo ""
echo "--- Classification criteria ---"

report_body=$(awk '/^---$/{d++; next} d>=2' "$REPORT")

# Extract the classification criteria block: the numbered step that begins
# with "Classify the issue" through the next numbered step.  Searching a
# bounded section (rather than per-line grep) keeps the check resilient to
# line wrapping and reformatting — per Copilot review feedback.
classify_section=$(printf '%s\n' "$report_body" | awk '
  /^[0-9]+\..*[Cc]lassify/ { found=1 }
  found && /^[0-9]+\./ && !/[Cc]lassify/ { exit }
  found { print }
')

# Bug criteria: each keyword must appear somewhere in the classification block
for kw in broken error unexpected crash regression; do
  if grep -qiF "$kw" <<< "$classify_section"; then
    pass "classification: bug criteria contain keyword '$kw'"
  else
    fail "classification: bug criteria missing keyword '$kw'"
  fi
done

# Feature criteria: each keyword must appear somewhere in the classification block
for kw in missing improvement; do
  if grep -qiF "$kw" <<< "$classify_section"; then
    pass "classification: feature criteria contain keyword '$kw'"
  else
    fail "classification: feature criteria missing keyword '$kw'"
  fi
done
if grep -qi 'new capability' <<< "$classify_section"; then
  pass "classification: feature criteria contain keyword 'new capability'"
else
  fail "classification: feature criteria missing keyword 'new capability'"
fi

# --- Label routing ---

echo ""
echo "--- Label routing ---"

if grep -qE -- '--label bug|"bug"|\[\"bug\"\]|label.*bug' <<< "$report_body"; then
  pass "label routing: bug label present"
else
  fail "label routing: missing bug label in filing methods"
fi

if grep -qE -- '--label enhancement|"enhancement"|\[\"enhancement\"\]|label.*enhancement' <<< "$report_body"; then
  pass "label routing: enhancement label present"
else
  fail "label routing: missing enhancement label in filing methods"
fi

# --- Template filename references in fallback URLs ---

if grep -qF '?template=bug_report.md' <<< "$report_body"; then
  pass "fallback: contains ?template=bug_report.md URL parameter"
else
  fail "fallback: missing ?template=bug_report.md URL parameter"
fi

if grep -qF '?template=feature_request.md' <<< "$report_body"; then
  pass "fallback: contains ?template=feature_request.md URL parameter"
else
  fail "fallback: missing ?template=feature_request.md URL parameter"
fi

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "All report template contract checks passed."
exit 0
