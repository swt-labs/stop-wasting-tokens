#!/usr/bin/env bash
#
# Post-publish smoke test: confirm a freshly-installed @swt-labs/cli works.
#
# Usage:
#   scripts/verify-install.sh <expected-version>
#
# Designed to run in CI after `npm install -g @swt-labs/cli` (or pnpm/bun
# equivalent). Returns 0 only when every check passes.
#
set -euo pipefail

EXPECTED_VERSION="${1:?usage: verify-install.sh <expected-version>}"
# Strip leading "v" if user passed a tag (v0.1.0-alpha → 0.1.0-alpha)
EXPECTED_VERSION="${EXPECTED_VERSION#v}"

echo "Verifying install for v${EXPECTED_VERSION}..."

# 1. Binary on PATH
if ! command -v swt >/dev/null 2>&1; then
  echo "✗ swt not on PATH after install" >&2
  exit 1
fi
echo "  ✓ swt is on PATH ($(command -v swt))"

# 2. Version match
INSTALLED=$(swt --version 2>/dev/null | head -1 | awk '{print $NF}')
if [ -z "$INSTALLED" ] || [ "$INSTALLED" != "$EXPECTED_VERSION" ]; then
  echo "✗ Version mismatch: expected ${EXPECTED_VERSION}, got '${INSTALLED}'" >&2
  exit 1
fi
echo "  ✓ swt --version reports ${INSTALLED}"

# 3. `swt help` lists the registered commands
HELP_OUTPUT=$(swt help 2>/dev/null || true)
if ! echo "$HELP_OUTPUT" | grep -q 'swt — stop-wasting-tokens'; then
  echo "✗ swt help did not produce the expected banner" >&2
  echo "Output was: $HELP_OUTPUT" >&2
  exit 1
fi
for cmd in vibe dashboard status doctor detect-phase update; do
  if ! echo "$HELP_OUTPUT" | grep -qE "^  ${cmd}( |$)"; then
    echo "✗ swt help missing expected command: ${cmd}" >&2
    exit 1
  fi
done
echo "  ✓ swt help lists vibe / dashboard / status / doctor / detect-phase / update"

# 4. detect-phase round-trips
#    (real command — emits a phase-detect dump even outside an SWT project)
DETECT_DIR=$(mktemp -d -t swt-verify-detect-XXXXXX)
trap 'rm -rf "$DETECT_DIR"' EXIT
pushd "$DETECT_DIR" >/dev/null
RESULT=$(swt detect-phase --json 2>/dev/null || true)
popd >/dev/null
if [ -z "$RESULT" ]; then
  echo "✗ swt detect-phase produced no output" >&2
  exit 1
fi
echo "  ✓ swt detect-phase returns JSON"

# 5. swt update --json (network-aware; --strict would fail offline so use default)
UPDATE_JSON=$(swt update --json 2>&1 || true)
if ! echo "$UPDATE_JSON" | grep -q '"status"'; then
  echo "✗ swt update --json did not return status field" >&2
  echo "Output was: $UPDATE_JSON" >&2
  exit 1
fi
echo "  ✓ swt update --json returns valid status payload"

# 6. swt dashboard end-to-end — boot the daemon, hit /api/health, kill it.
#    Catches "daemon bundle not found", "SPA fallback eats /api/*", and
#    "daemon refuses to start" classes of regression at the publish gate.
DASHBOARD_PORT=54399
DASHBOARD_DIR=$(mktemp -d -t swt-verify-dash-XXXXXX)
pushd "$DASHBOARD_DIR" >/dev/null
swt dashboard --port="$DASHBOARD_PORT" --no-open >/tmp/swt-dashboard.log 2>&1 &
DAEMON_PID=$!

# Wait up to 10s for the daemon to come up (CI runners are slow).
HEALTH_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -sf "http://127.0.0.1:${DASHBOARD_PORT}/api/health" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "✗ swt dashboard did not respond on http://127.0.0.1:${DASHBOARD_PORT}/api/health within 10s" >&2
  echo "  daemon log:" >&2
  sed 's/^/    /' /tmp/swt-dashboard.log >&2 || true
  kill "$DAEMON_PID" 2>/dev/null || true
  popd >/dev/null
  rm -rf "$DASHBOARD_DIR" /tmp/swt-dashboard.log
  exit 1
fi

# Snapshot endpoint should also work — covers the v1.6.2 regression where
# the SPA fallback was swallowing /api/* paths.
SNAPSHOT_JSON=$(curl -sf "http://127.0.0.1:${DASHBOARD_PORT}/api/snapshot" 2>/dev/null || true)
if ! printf '%s' "$SNAPSHOT_JSON" | grep -q '"is_initialized"'; then
  echo "✗ swt dashboard /api/snapshot did not return a valid snapshot (no is_initialized field)" >&2
  echo "  Output was: $SNAPSHOT_JSON" >&2
  kill "$DAEMON_PID" 2>/dev/null || true
  popd >/dev/null
  rm -rf "$DASHBOARD_DIR" /tmp/swt-dashboard.log
  exit 1
fi
echo "  ✓ swt dashboard boots + serves /api/health + /api/snapshot"

kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
popd >/dev/null
rm -rf "$DASHBOARD_DIR" /tmp/swt-dashboard.log

echo ""
echo "✓ Install verification passed for v${EXPECTED_VERSION}"
