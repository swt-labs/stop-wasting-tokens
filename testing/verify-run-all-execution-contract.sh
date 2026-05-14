#!/usr/bin/env bash
set -euo pipefail

# verify-run-all-execution-contract.sh — run-all.sh execution-guidance contract.
#
# Reconciled for SWT v3 (Phase 4 / Plan 04-05, G-M4).
#
# The original assertions were ported wholesale from upstream VBW (commit
# 2f02b97). They guarded `CONTRIBUTING.md` against removing a block of
# "do not pipe run-all.sh through tail/tee — it buffers until EOF and hides
# live progress" guidance. That guidance was never ported into SWT v3:
# `CONTRIBUTING.md` has zero mention of `run-all.sh` (its PR-checks section
# documents `pnpm typecheck/lint/test`), and `testing/README.md` — where the
# real SWT v3 run-all.sh docs live — carries no no-tail/no-pipe wording either.
# The test was guarding a contract that does not exist here.
#
# Note (research §7 R3): `testing/run-all.sh` reporting "BATS: skipped" because
# `$ROOT/tests/*.bats` does not exist is expected, harmless behavior — not the
# drift this test is concerned with.
#
# Per Plan 04-05: the obsolete existence-assertions are dropped. This test is
# NOT deleted here — any decision to remove it from
# `testing/list-contract-tests.sh` belongs to Plan 04-06. It is converted to a
# self-documenting SKIP that becomes a live contract again if the no-tail
# guidance is ever added to CONTRIBUTING.md.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/CONTRIBUTING.md"

echo "=== run-all Execution Contract Verification ==="

if [[ ! -f "$TARGET" ]]; then
  echo "SKIP  CONTRIBUTING.md not found — nothing to verify"
  exit 0
fi

# The run-all.sh no-tail guidance was never ported into SWT v3's CONTRIBUTING.md.
# If it is ever added, the contract below becomes live and starts guarding it.
if ! grep -iq 'run-all\.sh' "$TARGET"; then
  echo "SKIP  CONTRIBUTING.md does not document run-all.sh in SWT v3 — the"
  echo "SKIP  upstream-VBW no-tail/no-pipe execution guidance was never ported"
  echo "SKIP  (testing/README.md carries the real run-all.sh docs). Plan 04-06"
  echo "SKIP  owns any decision to drop this test from the contract registry."
  exit 0
fi

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

# CONTRIBUTING.md must contain the no-tail guidance specifically for run-all.sh.
# Extract the run-all.sh line and verify the no-pipe wording is co-located.
if grep -i 'run-all\.sh' "$TARGET" | grep -Eiq 'do not pipe.*tail|do not pipe.*tee'; then
  pass "CONTRIBUTING.md: run-all.sh line contains no-pipe/no-tail directive"
else
  fail "CONTRIBUTING.md: no line mentions both run-all.sh and no-pipe/no-tail directive"
fi

if grep -Eiq 'tail -20|tail -40' "$TARGET"; then
  pass "CONTRIBUTING.md: includes concrete tail wrapper examples"
else
  fail "CONTRIBUTING.md: missing concrete tail wrapper examples"
fi

if grep -Eiq 'buffer until EOF|buffer until eof|hide live progress' "$TARGET"; then
  pass "CONTRIBUTING.md: explains why tail wrappers are unsafe"
else
  fail "CONTRIBUTING.md: missing rationale for no-tail execution"
fi

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="
[ "$FAIL" -eq 0 ] || exit 1
