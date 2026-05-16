#!/usr/bin/env bash
#
# Upstream-prompt drift audit.
#
# Purpose
# -------
# SWT's provider overlays (provider_overlays/*-openai.md) and frontmatter
# `source_paths` cite specific upstream coding-agent artifacts:
#   1. Codex CLI base prompt:
#        github.com/openai/codex codex-rs/core/gpt_5_codex_prompt.md
#   2. Claude Agent SDK type surface:
#        npm package @anthropic-ai/claude-agent-sdk → package/sdk.d.ts
#
# These upstreams WILL drift. Without automated detection, the overlay
# citations silently stale. This script fetches the two artifacts, computes
# sha256 over each, and compares against pinned baselines under
# .vbw-planning/upstream-prompt-snapshots/<YYYY-MM-DD>/. It is detection-only:
# on drift it emits a one-line report per artifact to stdout; the wrapping
# GitHub Actions workflow turns that report into a GitHub Issue.
#
# CI hookup: .github/workflows/upstream-prompt-audit.yml runs this script
# in --verify mode on a monthly cron (0 0 1 * *) plus manual workflow_dispatch.
# Cadence rationale: TDD §11.6 (conservative default — monthly is intentional
# under-sampling; escalate to weekly only if first cron detects drift).
#
# License hygiene
# ---------------
# Upstream artifacts are fetched into a tempdir, hashed, and DELETED on EXIT
# (trap). Only the sha256 hex strings + filenames are persisted long-term.
# Nothing in this script's code path writes verbatim upstream text to disk
# or to the drift report. See provider_overlays/README.md "Upstream-drift
# audit" → "License hygiene" for the maintainer-facing version of this rule.
#
# Usage
# -----
#   scripts/audit-upstream-prompts.sh --verify
#       Read-only. Fetches upstream, compares to most-recent baseline.
#       Exit 0 silently on clean. Exit 0 with `DRIFT: ...` stdout lines on
#       drift (the CI workflow parses stdout — drift is informational, not
#       a non-zero exit). Exit non-zero on fetch / sha256-binary failure.
#
#   scripts/audit-upstream-prompts.sh --update
#       Mutates baselines. Writes new sha256 files under
#       .vbw-planning/upstream-prompt-snapshots/$(date -u +%Y-%m-%d)/.
#       Maintainer-driven only — NEVER invoked by the cron.
#
#   scripts/audit-upstream-prompts.sh --verify --dry-run
#       Offline test seam. Reads `codex-prompt.md` + `claude-agent-sdk.d.ts`
#       from $SWT_AUDIT_FIXTURE_DIR instead of fetching over the network.
#       Used by scripts/test-audit-upstream-prompts.sh.
#
#   scripts/audit-upstream-prompts.sh --help
#       Print usage and exit 0.
#
# Exit codes
# ----------
#   0 = clean OR drift detected (drift is via stdout) OR --update succeeded
#   1 = generic failure (fetch failed, mode conflict, parse failed)
#   2 = neither sha256sum nor shasum on PATH
#   3 = baseline dir not found / baseline files malformed
#
set -euo pipefail

# --- constants ---------------------------------------------------------------

CODEX_URL="https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt_5_codex_prompt.md"
CLAUDE_SDK_PKG="@anthropic-ai/claude-agent-sdk"
CLAUDE_SDK_FILE="package/sdk.d.ts"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOTS_DIR="$REPO_ROOT/.vbw-planning/upstream-prompt-snapshots"

# --- arg parsing -------------------------------------------------------------

MODE=""
DRY_RUN=0

usage() {
  sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' | sed '/^set -euo pipefail$/d'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --verify)
      if [ "$MODE" = "update" ]; then
        echo "ERROR: --verify and --update are mutually exclusive" >&2
        exit 1
      fi
      MODE="verify"
      ;;
    --update)
      if [ "$MODE" = "verify" ]; then
        echo "ERROR: --verify and --update are mutually exclusive" >&2
        exit 1
      fi
      MODE="update"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      echo "" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ -z "$MODE" ]; then
  MODE="verify"
fi

# --- sha256 detection --------------------------------------------------------

compute_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    echo "ERROR: neither sha256sum nor shasum found on PATH" >&2
    exit 2
  fi
}

# --- tempdir + cleanup -------------------------------------------------------

WORK_DIR="$(mktemp -d -t swt-audit-upstream-XXXXXX)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# --- fetch -------------------------------------------------------------------

fetch_artifacts() {
  # Populates $WORK_DIR/codex-prompt.md and $WORK_DIR/claude-agent-sdk.d.ts.
  # Honors --dry-run + $SWT_AUDIT_FIXTURE_DIR for offline test seam.

  if [ "$DRY_RUN" = "1" ]; then
    if [ -z "${SWT_AUDIT_FIXTURE_DIR:-}" ]; then
      echo "ERROR: --dry-run requires SWT_AUDIT_FIXTURE_DIR to be set" >&2
      exit 1
    fi
    local fixture_codex="$SWT_AUDIT_FIXTURE_DIR/codex-prompt.md"
    local fixture_sdk="$SWT_AUDIT_FIXTURE_DIR/claude-agent-sdk.d.ts"
    if [ ! -f "$fixture_codex" ]; then
      echo "ERROR: fixture missing: $fixture_codex" >&2
      exit 1
    fi
    if [ ! -f "$fixture_sdk" ]; then
      echo "ERROR: fixture missing: $fixture_sdk" >&2
      exit 1
    fi
    cp "$fixture_codex" "$WORK_DIR/codex-prompt.md"
    cp "$fixture_sdk" "$WORK_DIR/claude-agent-sdk.d.ts"
    return 0
  fi

  # 1. Codex CLI base prompt — direct raw fetch.
  if ! curl -fSL "$CODEX_URL" -o "$WORK_DIR/codex-prompt.md" 2>"$WORK_DIR/curl.err"; then
    echo "ERROR: failed to fetch Codex CLI prompt from $CODEX_URL" >&2
    sed 's/^/  curl: /' "$WORK_DIR/curl.err" >&2 || true
    exit 1
  fi

  # 2. Claude Agent SDK — npm view → curl tarball → tar extract.
  local tarball_url
  if ! tarball_url=$(npm view "$CLAUDE_SDK_PKG" dist.tarball 2>"$WORK_DIR/npm.err"); then
    echo "ERROR: failed to resolve tarball URL for $CLAUDE_SDK_PKG via npm view" >&2
    sed 's/^/  npm: /' "$WORK_DIR/npm.err" >&2 || true
    exit 1
  fi
  if [ -z "$tarball_url" ]; then
    echo "ERROR: npm view returned empty tarball URL for $CLAUDE_SDK_PKG" >&2
    exit 1
  fi

  if ! curl -fSL "$tarball_url" -o "$WORK_DIR/claude-agent-sdk.tgz" 2>"$WORK_DIR/curl.err"; then
    echo "ERROR: failed to fetch Claude Agent SDK tarball from $tarball_url" >&2
    sed 's/^/  curl: /' "$WORK_DIR/curl.err" >&2 || true
    exit 1
  fi

  # Extract only the sdk.d.ts file; redirect to a fixed name in WORK_DIR.
  if ! tar -xzOf "$WORK_DIR/claude-agent-sdk.tgz" "$CLAUDE_SDK_FILE" \
      > "$WORK_DIR/claude-agent-sdk.d.ts" 2>"$WORK_DIR/tar.err"; then
    echo "ERROR: failed to extract $CLAUDE_SDK_FILE from Claude Agent SDK tarball" >&2
    sed 's/^/  tar: /' "$WORK_DIR/tar.err" >&2 || true
    exit 1
  fi
  if [ ! -s "$WORK_DIR/claude-agent-sdk.d.ts" ]; then
    echo "ERROR: extracted $CLAUDE_SDK_FILE is empty" >&2
    exit 1
  fi
}

# --- baseline resolution -----------------------------------------------------

resolve_baseline_dir() {
  if [ ! -d "$SNAPSHOTS_DIR" ]; then
    echo "ERROR: snapshots dir not found: $SNAPSHOTS_DIR" >&2
    echo "  (run with --update to create initial baselines)" >&2
    exit 3
  fi
  local latest
  latest=$(find "$SNAPSHOTS_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' \
    | sort -r | head -1)
  if [ -z "$latest" ]; then
    echo "ERROR: no date-stamped baseline subdir under $SNAPSHOTS_DIR" >&2
    echo "  (run with --update to create initial baselines)" >&2
    exit 3
  fi
  echo "$latest"
}

read_baseline_hash() {
  # $1 = baseline file path. Returns the first whitespace-delimited token (the hex).
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "ERROR: baseline file missing: $file" >&2
    exit 3
  fi
  local hex
  hex=$(awk '{print $1; exit}' "$file")
  if [ -z "$hex" ] || [ "${#hex}" -ne 64 ]; then
    echo "ERROR: malformed baseline file (expected 64-hex first token): $file" >&2
    exit 3
  fi
  echo "$hex"
}

# --- verify mode -------------------------------------------------------------

run_verify() {
  fetch_artifacts

  local baseline_dir
  baseline_dir=$(resolve_baseline_dir)

  local codex_baseline_hex sdk_baseline_hex
  codex_baseline_hex=$(read_baseline_hash "$baseline_dir/codex-prompt.sha256")
  sdk_baseline_hex=$(read_baseline_hash "$baseline_dir/claude-agent-sdk.sha256")

  local codex_current_hex sdk_current_hex
  codex_current_hex=$(compute_sha256 "$WORK_DIR/codex-prompt.md")
  sdk_current_hex=$(compute_sha256 "$WORK_DIR/claude-agent-sdk.d.ts")

  local drift_count=0

  if [ "$codex_current_hex" != "$codex_baseline_hex" ]; then
    printf 'DRIFT: codex-prompt baseline=%s... current=%s... source=%s\n' \
      "${codex_baseline_hex:0:8}" "${codex_current_hex:0:8}" "$CODEX_URL"
    drift_count=$((drift_count + 1))
  fi

  if [ "$sdk_current_hex" != "$sdk_baseline_hex" ]; then
    printf 'DRIFT: claude-agent-sdk baseline=%s... current=%s... source=npm:%s/%s\n' \
      "${sdk_baseline_hex:0:8}" "${sdk_current_hex:0:8}" "$CLAUDE_SDK_PKG" "$CLAUDE_SDK_FILE"
    drift_count=$((drift_count + 1))
  fi

  # Exit 0 either way — drift uses stdout, not exit code (per --verify contract).
  if [ "$drift_count" = "0" ]; then
    # Silence on clean.
    :
  fi
  exit 0
}

# --- update mode -------------------------------------------------------------

run_update() {
  fetch_artifacts

  local codex_hex sdk_hex
  codex_hex=$(compute_sha256 "$WORK_DIR/codex-prompt.md")
  sdk_hex=$(compute_sha256 "$WORK_DIR/claude-agent-sdk.d.ts")

  local date_dir
  date_dir="$SNAPSHOTS_DIR/$(date -u +%Y-%m-%d)"
  mkdir -p "$date_dir"

  # sha256sum-output format: <hex><two spaces><filename>
  printf '%s  %s\n' "$codex_hex" "codex-prompt.md" > "$date_dir/codex-prompt.sha256"
  printf '%s  %s\n' "$sdk_hex" "claude-agent-sdk.d.ts" > "$date_dir/claude-agent-sdk.sha256"

  {
    echo "Wrote baselines to: $date_dir"
    echo "  codex-prompt.sha256        = $codex_hex"
    echo "  claude-agent-sdk.sha256    = $sdk_hex"
  } >&2

  exit 0
}

# --- main --------------------------------------------------------------------

case "$MODE" in
  verify)
    run_verify
    ;;
  update)
    run_update
    ;;
  *)
    echo "ERROR: unhandled mode: $MODE" >&2
    exit 1
    ;;
esac
