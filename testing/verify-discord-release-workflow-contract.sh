#!/usr/bin/env bash
set -euo pipefail

# verify-discord-release-workflow-contract.sh — Discord release-notification
# workflow contract.
#
# Reconciled for SWT v3 (Phase 4 / Plan 04-05, G-M4).
#
# The original assertions were ported wholesale from upstream VBW (commit
# 2f02b97) and asserted the shape of `.github/workflows/discord-release.yml`
# plus a `scripts/post-discord-release.sh` notifier. Neither artifact exists in
# SWT v3 and neither ever did — `git log --all --diff-filter=D` for the
# workflow path returns nothing (it was never added, only the test script was
# ported). SWT v3 ships release notifications differently and the
# Discord-webhook release workflow was never adopted.
#
# Per Plan 04-05: when the workflow does not exist, the existence-assertions are
# obsolete and dropped. This test is NOT deleted here — any decision to remove
# it from `testing/list-contract-tests.sh` belongs to Plan 04-06. It is
# converted to a self-documenting SKIP so it stops asserting a contract that
# does not exist while remaining discoverable in the registry.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/discord-release.yml"

echo "=== Discord Release Workflow Contract Verification ==="

if [[ ! -f "$WORKFLOW" ]]; then
  echo "SKIP  .github/workflows/discord-release.yml does not exist in SWT v3 —"
  echo "SKIP  the Discord release-notification workflow was never adopted (the"
  echo "SKIP  upstream-VBW assertions were obsolete). Plan 04-06 owns any"
  echo "SKIP  decision to drop this test from the contract registry."
  exit 0
fi

# If a discord-release.yml is ever (re)introduced, the workflow-shape contract
# below becomes live again. Until then the SKIP above short-circuits.
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

if grep -q '^name: Discord Release Notification$' "$WORKFLOW"; then
  pass "discord-release.yml: workflow name is present"
else
  fail "discord-release.yml: workflow name is missing"
fi

if grep -q '^  release:$' "$WORKFLOW" && grep -q '^    types: \[published\]$' "$WORKFLOW"; then
  pass "discord-release.yml: triggers on release.published"
else
  fail "discord-release.yml: does not trigger on release.published"
fi

if grep -q '^permissions:$' "$WORKFLOW" && grep -q '^  contents: read$' "$WORKFLOW"; then
  pass "discord-release.yml: limits token permissions to contents: read"
else
  fail "discord-release.yml: does not declare contents: read permissions"
fi

if grep -q 'uses: actions/checkout@v4' "$WORKFLOW"; then
  pass "discord-release.yml: checks out the repository"
else
  fail "discord-release.yml: missing actions/checkout@v4"
fi

if grep -Fq 'ref: refs/heads/${{ github.event.repository.default_branch }}' "$WORKFLOW"; then
  pass "discord-release.yml: checks out the default branch ref instead of the release tag"
else
  fail "discord-release.yml: does not pin checkout to the default branch ref"
fi

if grep -Fq 'WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}' "$WORKFLOW"; then
  pass "discord-release.yml: sources DISCORD_WEBHOOK_URL from repo secrets"
else
  fail "discord-release.yml: missing DISCORD_WEBHOOK_URL secret wiring"
fi

if grep -Fq 'RELEASE_NAME: ${{ github.event.release.name }}' "$WORKFLOW" && \
   grep -Fq 'RELEASE_TAG: ${{ github.event.release.tag_name }}' "$WORKFLOW" && \
   grep -Fq 'RELEASE_URL: ${{ github.event.release.html_url }}' "$WORKFLOW" && \
   grep -Fq 'RELEASE_BODY: ${{ github.event.release.body }}' "$WORKFLOW"; then
  pass "discord-release.yml: passes release name, tag, URL, and body into the notifier script"
else
  fail "discord-release.yml: missing one or more release payload environment bindings"
fi

if grep -q '^        run: bash scripts/post-discord-release.sh$' "$WORKFLOW"; then
  pass "discord-release.yml: invokes the shared notifier script"
else
  fail "discord-release.yml: does not invoke scripts/post-discord-release.sh"
fi

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "Discord release workflow contract checks passed."
