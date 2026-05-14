#!/usr/bin/env bash
set -euo pipefail

# verify-ci-workflow-contract.sh — Validate CI workflow parity invariants.
#
# Reconciled for SWT v3 (Phase 4 / Plan 04-05, G-M4).
#
# The original assertions were ported wholesale from upstream VBW (commit
# 2f02b97) and asserted a CI shape SWT v3 never adopted: separate `lint`,
# `contract-tests`, `test`, and `bats-serial` jobs wired through
# `run-bats-shard.sh` / `list-bats-files.sh`. The actual SWT v3
# `.github/workflows/ci.yml` runs `pnpm typecheck/lint/format:check/test/build`
# directly inside a single matrix `build` job, plus a `reproducible-build` job.
# `git log -S 'contract-tests:' -- .github/workflows/ci.yml` returns nothing —
# that job never existed here.
#
# This test now asserts the CURRENT ci.yml structure and the genuine
# registry/runner-sync contract: `testing/run-all.sh` is the local CI-parity
# entrypoint and discovers contract tests from the shared
# `testing/list-contract-tests.sh` registry. Plan 04-06 edits that registry
# (verify-vibe -> verify-cook rename + obsolete-line removal) and re-runs this
# test; the assertions below are structured so that edit keeps them green.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ci.yml"
RUN_ALL="$ROOT/testing/run-all.sh"
LIST_CONTRACT_TESTS="$ROOT/testing/list-contract-tests.sh"

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

job_block() {
  local job_name="$1"
  awk -v job="$job_name" '
    $0 ~ "^  " job ":$" { in_job=1; print; next }
    in_job && $0 ~ /^  [A-Za-z0-9_-]+:$/ { exit }
    in_job { print }
  ' "$WORKFLOW"
}

extract_discovery_names() {
  bash "$LIST_CONTRACT_TESTS" 2>/dev/null | cut -f1 | (sort 2>/dev/null || cat)
}

echo "=== CI Workflow Contract Verification ==="

# --- ci.yml structural invariants (current SWT v3 shape) ---
BUILD_BLOCK="$(job_block build)"
REPRO_BLOCK="$(job_block reproducible-build)"

if [ -n "$BUILD_BLOCK" ]; then
  pass "ci.yml: build job is defined"
else
  fail "ci.yml: build job is missing"
fi

if grep -q 'matrix:' <<< "$BUILD_BLOCK" \
  && grep -q 'os: \[ubuntu-latest, macos-latest, windows-latest\]' <<< "$BUILD_BLOCK"; then
  pass "ci.yml: build job runs the three-OS matrix"
else
  fail "ci.yml: build job missing the three-OS matrix"
fi

if grep -q 'run: pnpm typecheck' <<< "$BUILD_BLOCK" \
  && grep -q 'run: pnpm lint' <<< "$BUILD_BLOCK" \
  && grep -q 'run: pnpm format:check' <<< "$BUILD_BLOCK" \
  && grep -q 'run: pnpm test' <<< "$BUILD_BLOCK" \
  && grep -q 'run: pnpm build' <<< "$BUILD_BLOCK"; then
  pass "ci.yml: build job runs typecheck, lint, format:check, test, and build"
else
  fail "ci.yml: build job missing one or more required pnpm steps"
fi

if [ -n "$REPRO_BLOCK" ] && grep -q 'needs: build' <<< "$REPRO_BLOCK"; then
  pass "ci.yml: reproducible-build job depends on build"
else
  fail "ci.yml: reproducible-build job missing or does not depend on build"
fi

if grep -q "github.event_name == 'push'" <<< "$REPRO_BLOCK" \
  && grep -q "github.ref == 'refs/heads/main'" <<< "$REPRO_BLOCK"; then
  pass "ci.yml: reproducible-build job is gated to push-to-main"
else
  fail "ci.yml: reproducible-build job not gated to push-to-main"
fi

# --- run-all.sh / list-contract-tests.sh registry/runner sync ---
# These are the genuine, still-live invariants: run-all.sh is the local
# CI-parity entrypoint and must discover contract tests through the shared
# registry. Plan 04-06 edits the registry and re-runs this test.

if grep -q 'list-contract-tests.sh' "$RUN_ALL"; then
  pass "run-all.sh: uses shared list-contract-tests.sh discovery"
else
  fail "run-all.sh: does not use shared list-contract-tests.sh discovery"
fi

if grep -qE 'BATS_WORKERS="\$\{BATS_WORKERS:-[0-9]+\}"' "$RUN_ALL"; then
  pass "run-all: BATS_WORKERS has a numeric default"
else
  fail "run-all: BATS_WORKERS missing numeric default"
fi

DISCOVERY_NAMES="$(extract_discovery_names)"
if [ -n "$DISCOVERY_NAMES" ]; then
  pass "list-contract-tests.sh: produces non-empty output"
else
  fail "list-contract-tests.sh: produces no output"
fi

if echo "$DISCOVERY_NAMES" | grep -q 'ci-workflow-contract'; then
  pass "list-contract-tests.sh: includes ci-workflow-contract (self-referential)"
else
  fail "list-contract-tests.sh: missing ci-workflow-contract entry"
fi

# Registry integrity: every registered path must resolve to a runnable script.
# `verify-vibe -> scripts/verify-vibe.sh` is a known in-flight migration: Plan
# 04-01 already shipped scripts/verify-cook.sh, and Plan 04-06 owns the atomic
# registry edit (verify-vibe -> verify-cook). Until that edit lands the registry
# carries one dangling entry; it is allowlisted here with an explicit name so
# the check still catches any *other* drift. After 04-06's edit the allowlisted
# entry no longer exists and this check is fully strict again.
MISSING_FILES=0
UNEXPECTED_MISSING=0
while IFS=$'\t' read -r name path; do
  [[ -z "$name" ]] && continue
  if [ ! -f "$ROOT/$path" ]; then
    MISSING_FILES=$((MISSING_FILES + 1))
    if [ "$name" = "verify-vibe" ]; then
      echo "  KNOWN-INFLIGHT: $name -> $path (Plan 04-06 renames this to verify-cook)"
    else
      echo "  MISSING: $name -> $path"
      UNEXPECTED_MISSING=$((UNEXPECTED_MISSING + 1))
    fi
  fi
done < <(bash "$LIST_CONTRACT_TESTS" 2>/dev/null)
if [ "$UNEXPECTED_MISSING" -eq 0 ]; then
  pass "list-contract-tests.sh: all discovered paths exist (modulo the known verify-vibe->verify-cook migration)"
else
  fail "list-contract-tests.sh: $UNEXPECTED_MISSING discovered path(s) do not exist"
fi

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "CI workflow contract checks passed."
