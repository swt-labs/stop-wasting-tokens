#!/usr/bin/env bash
set -euo pipefail

# verify-permission-mode-contract.sh — Verify agent permissionMode declarations
#
# Checks:
# - Plan-mode agents (Scout, QA) declare permissionMode: plan
# - Edit agents (Dev, Lead, Architect, Debugger, Docs) declare permissionMode: acceptEdits
# - Every agent has an explicit permissionMode in frontmatter

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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

check_contains() {
  local label="$1"
  local haystack="$2"
  local needle="$3"

  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

check_not_contains() {
  local label="$1"
  local haystack="$2"
  local needle="$3"

  if [[ "$haystack" == *"$needle"* ]]; then
    fail "$label"
  else
    pass "$label"
  fi
}

normalize_tool_list() {
  local list="$1"
  printf '%s\n' "$list" \
    | sed 's/^[^:]*:[[:space:]]*//' \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | awk 'NF { print }' \
    | LC_ALL=C sort
}

echo "=== Agent permissionMode Contract Verification ==="

# Define expected permission modes (bash 3.2 compatible — no associative arrays)
AGENTS="swt-scout swt-qa swt-dev swt-lead swt-architect swt-debugger swt-docs"

get_expected_mode() {
  case "$1" in
    swt-scout|swt-qa) echo "plan" ;;
    *) echo "acceptEdits" ;;
  esac
}

for agent in $AGENTS; do
  AGENT_FILE="$ROOT/agents/${agent}.md"
  SHORT_NAME="${agent#swt-}"
  EXPECTED="$(get_expected_mode "$agent")"

  if [[ ! -f "$AGENT_FILE" ]]; then
    fail "${SHORT_NAME}: agent file missing"
    continue
  fi

  # Check that permissionMode is declared in frontmatter (first 15 lines)
  ACTUAL=$(head -15 "$AGENT_FILE" | grep "^permissionMode:" | sed 's/^permissionMode: *//' | tr -d '[:space:]')
  if [[ -z "$ACTUAL" ]]; then
    fail "${SHORT_NAME}: permissionMode not declared in frontmatter (expected: ${EXPECTED})"
  elif [[ "$ACTUAL" == "$EXPECTED" ]]; then
    pass "${SHORT_NAME}: permissionMode is ${ACTUAL}"
  else
    fail "${SHORT_NAME}: permissionMode is ${ACTUAL} (expected: ${EXPECTED})"
  fi
done

# NOTE (Phase 4 / Plan 04-03, G-M4 assertion-drift reconciliation):
# The README permission table (Dev/Scout rows, `Denied / Omitted` legend, inherited-tools
# language) was intentionally removed by commit 36a1efd (`docs(readme): purge pre-v3 traces`).
# The AUTHORITATIVE source of permission contracts is the `disallowedTools` frontmatter in
# `agents/swt-*.md` — which this test still validates directly below. The stale
# README-table assertions have been removed here; re-authoring a README permission table
# is a decision-gated production edit escalated to Plan 04-06.
DEV_DESCRIPTION=$(head -15 "$ROOT/agents/swt-dev.md" | grep '^description:' || true)
DEV_DISALLOWED_FRONTMATTER=$(head -15 "$ROOT/agents/swt-dev.md" | awk '/^disallowedTools:/ { sub(/^disallowedTools:[[:space:]]*/, ""); print }')
SCOUT_DISALLOWED_FRONTMATTER=$(head -15 "$ROOT/agents/swt-scout.md" | awk '/^disallowedTools:/ { sub(/^disallowedTools:[[:space:]]*/, ""); print }')
DEV_DENIED_NORMALIZED=$(normalize_tool_list "$DEV_DISALLOWED_FRONTMATTER")
SCOUT_DENIED_NORMALIZED=$(normalize_tool_list "$SCOUT_DISALLOWED_FRONTMATTER")

if [ -n "$DEV_DISALLOWED_FRONTMATTER" ]; then
  pass "swt-dev.md: frontmatter declares disallowedTools denylist"
else
  fail "swt-dev.md: frontmatter must declare disallowedTools denylist"
fi

if [ -n "$SCOUT_DISALLOWED_FRONTMATTER" ]; then
  pass "swt-scout.md: frontmatter declares disallowedTools denylist"
else
  fail "swt-scout.md: frontmatter must declare disallowedTools denylist"
fi

check_not_contains "swt-dev.md: description no longer says explicit allowlist" "$DEV_DESCRIPTION" "explicit implementation tool allowlist"
check_contains "swt-dev.md: description mentions denylist-controlled tool access" "$DEV_DESCRIPTION" "denylist-controlled"

if head -15 "$ROOT/agents/swt-dev.md" | grep -q '^tools:'; then
  fail "swt-dev.md: frontmatter must not use a tools allowlist (use disallowedTools denylist for forward compatibility)"
else
  pass "swt-dev.md: frontmatter does not use a tools allowlist"
fi

for required_denied in Task TaskCreate Agent TeamCreate TeamDelete AskUserQuestion; do
  if printf '%s\n' "$DEV_DENIED_NORMALIZED" | grep -Fxq "$required_denied"; then
    pass "swt-dev.md: disallowedTools bans $required_denied"
  else
    fail "swt-dev.md: disallowedTools must ban $required_denied"
  fi
done

for must_not_deny in Bash Read Edit Write Glob Grep LSP Skill WebFetch WebSearch SendMessage TaskGet; do
  if printf '%s\n' "$DEV_DENIED_NORMALIZED" | grep -Fxq "$must_not_deny"; then
    fail "swt-dev.md: disallowedTools must not ban $must_not_deny (Dev relies on it)"
  else
    pass "swt-dev.md: disallowedTools does not ban $must_not_deny"
  fi
done

for required_denied in Edit NotebookEdit Task TaskCreate Agent TeamCreate TeamDelete; do
  if printf '%s\n' "$SCOUT_DENIED_NORMALIZED" | grep -Fxq "$required_denied"; then
    pass "swt-scout.md: disallowedTools bans $required_denied"
  else
    fail "swt-scout.md: disallowedTools must ban $required_denied"
  fi
done

for must_not_deny in Bash Read Write Glob Grep LSP Skill WebFetch WebSearch; do
  if printf '%s\n' "$SCOUT_DENIED_NORMALIZED" | grep -Fxq "$must_not_deny"; then
    fail "swt-scout.md: disallowedTools must not ban $must_not_deny (Scout relies on it)"
  else
    pass "swt-scout.md: disallowedTools does not ban $must_not_deny"
  fi
done

echo ""
echo "TOTAL  ${PASS} PASS, ${FAIL} FAIL"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
