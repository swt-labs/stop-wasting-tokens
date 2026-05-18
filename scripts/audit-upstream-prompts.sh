#!/usr/bin/env bash
#
# Upstream-prompt drift audit.
#
# Purpose
# -------
# SWT's provider overlays (provider_overlays/*-openai.md), `apply_patch`
# parser, and frontmatter `source_paths` cite specific upstream
# coding-agent artifacts. These upstreams WILL drift. Without automated
# detection, the citations silently stale.
#
# Phase 5 refactor: this script no longer hard-codes URL constants.
# The single source of truth is `swt provider-tuning-sources`, which
# emits an enriched JSON envelope `{schema:"v1", generated_at,
# sources:[{packId, packDisplayName, method:"upstreamSources",
# url, description, contentHash?, lastReviewedSha?}, ...]}` driven by
# each `ProviderTuningPack.upstreamSources()`. Adding a new watched
# upstream is a one-place change in the pack — this script picks it up
# automatically on the next run.
#
# URLs starting with `npm:` (e.g. `npm:@anthropic-ai/claude-agent-sdk
# #package/sdk.d.ts`) signal the npm-tarball fetch path; everything
# else is fetched with `curl -fSL`.
#
# The script computes sha256 over each fetched body and compares against
# pinned baselines under .vbw-planning/upstream-prompt-snapshots/
# <YYYY-MM-DD>/<slug>.sha256. It is detection-only: on drift it emits a
# one-line report per source to stdout; the wrapping GitHub Actions
# workflow turns that report into a GitHub Issue.
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
#       Read-only. Fetches each upstream named by `swt provider-tuning-
#       sources`, compares to most-recent baseline. Exit 0 silently on
#       clean. Exit 0 with `DRIFT: ...` stdout lines on drift (the CI
#       workflow parses stdout — drift is informational, not a non-zero
#       exit). Exit non-zero on fetch / sha256-binary failure.
#
#   scripts/audit-upstream-prompts.sh --update
#       Mutates baselines. Writes new sha256 files under
#       .vbw-planning/upstream-prompt-snapshots/$(date -u +%Y-%m-%d)/,
#       one file per source slug. Maintainer-driven only — NEVER
#       invoked by the cron.
#
#   scripts/audit-upstream-prompts.sh --verify --dry-run
#       Offline test seam. Reads $SWT_AUDIT_FIXTURE_DIR/<slug>.body for
#       each source. The source list itself can be overridden by setting
#       $SWT_AUDIT_SOURCES_FIXTURE to the path of a JSON envelope (same
#       shape as `swt provider-tuning-sources`); when unset, the CLI is
#       still invoked. Used by scripts/test-audit-upstream-prompts.sh.
#
#   scripts/audit-upstream-prompts.sh --help
#       Print usage and exit 0.
#
# Exit codes
# ----------
#   0 = clean OR drift detected (drift is via stdout) OR --update succeeded
#   1 = generic failure (fetch failed, mode conflict, parse failed, jq missing)
#   2 = neither sha256sum nor shasum on PATH
#   3 = baseline dir not found / baseline files malformed
#
set -euo pipefail

# --- constants ---------------------------------------------------------------
#
# NOTE: no hardcoded http(s)/npm: URL constants live here anymore. The
# source list is fetched from `swt provider-tuning-sources` (or from
# $SWT_AUDIT_SOURCES_FIXTURE for offline tests).

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

# --- jq dependency check -----------------------------------------------------

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required (parses the swt provider-tuning-sources envelope)" >&2
  exit 1
fi

# --- source list (single source of truth) ------------------------------------
#
# Fetch the source list from the CLI. Schema contract: `swt provider-
# tuning-sources` emits `{schema: "v1", generated_at, sources: [...]}`
# where each source has `{packId, packDisplayName, method, url,
# description, contentHash?, lastReviewedSha?}`. We assert `schema ==
# "v1"` so a future envelope change forces an explicit script refactor
# instead of silent breakage.

if [ "${SWT_AUDIT_SOURCES_FIXTURE:-}" != "" ]; then
  if [ ! -f "$SWT_AUDIT_SOURCES_FIXTURE" ]; then
    echo "ERROR: SWT_AUDIT_SOURCES_FIXTURE points at missing file: $SWT_AUDIT_SOURCES_FIXTURE" >&2
    exit 1
  fi
  SOURCES_JSON="$(cat "$SWT_AUDIT_SOURCES_FIXTURE")"
else
  if ! SOURCES_JSON="$(swt provider-tuning-sources 2>"$WORK_DIR/swt.err")"; then
    echo "ERROR: \`swt provider-tuning-sources\` failed — is the CLI built and on PATH?" >&2
    sed 's/^/  swt: /' "$WORK_DIR/swt.err" >&2 || true
    exit 1
  fi
fi

SCHEMA="$(printf '%s' "$SOURCES_JSON" | jq -r '.schema')"
if [ "$SCHEMA" != "v1" ]; then
  echo "ERROR: unexpected provider-tuning-sources schema: $SCHEMA (expected v1)" >&2
  exit 1
fi

# --- slug helper -------------------------------------------------------------
#
# Deterministic baseline filename derived from `description`. Lowercases
# all alphanumerics, replaces runs of non-alphanumerics with single
# dashes, and strips leading/trailing dashes. Slug uniqueness across
# sources is asserted below.

slug_for() {
  printf '%s' "$1" | tr -c '[:alnum:]' '-' | tr -s '-' | sed 's/^-//;s/-$//' | tr '[:upper:]' '[:lower:]'
}

# --- slug-collision guard ----------------------------------------------------
#
# If two sources happen to share a description-derived slug, they would
# collide at baseline-file write time and silently mask one another. Fail
# fast with a clear error so the maintainer can rename a description.

SOURCE_COUNT="$(printf '%s' "$SOURCES_JSON" | jq -r '.sources | length')"
declare -a ALL_SLUGS=()
i=0
while [ "$i" -lt "$SOURCE_COUNT" ]; do
  desc="$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].description")"
  ALL_SLUGS+=("$(slug_for "$desc")")
  i=$((i + 1))
done
UNIQ_SLUGS="$(printf '%s\n' "${ALL_SLUGS[@]}" | sort -u | wc -l | tr -d ' ')"
if [ "$UNIQ_SLUGS" != "$SOURCE_COUNT" ]; then
  echo "ERROR: slug collision in source list — two sources share a description-derived slug" >&2
  printf '  %s\n' "${ALL_SLUGS[@]}" | sort | uniq -c | awk '$1 > 1 {print "  duplicate: " $2}' >&2
  exit 1
fi
unset ALL_SLUGS i desc UNIQ_SLUGS

# --- fetch -------------------------------------------------------------------

fetch_artifacts() {
  # Populates $WORK_DIR/<slug>.body for each source in $SOURCES_JSON.
  # Honors --dry-run + $SWT_AUDIT_FIXTURE_DIR for offline test seam.
  local i=0
  local count
  count="$(printf '%s' "$SOURCES_JSON" | jq -r '.sources | length')"
  while [ "$i" -lt "$count" ]; do
    local url description slug out
    url="$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].url")"
    description="$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].description")"
    slug="$(slug_for "$description")"
    out="$WORK_DIR/$slug.body"

    if [ "$DRY_RUN" = "1" ]; then
      if [ -z "${SWT_AUDIT_FIXTURE_DIR:-}" ]; then
        echo "ERROR: --dry-run requires SWT_AUDIT_FIXTURE_DIR to be set" >&2
        exit 1
      fi
      local fixture="$SWT_AUDIT_FIXTURE_DIR/$slug.body"
      if [ ! -f "$fixture" ]; then
        echo "ERROR: fixture missing: $fixture" >&2
        exit 1
      fi
      cp "$fixture" "$out"
    elif [[ "$url" == npm:* ]]; then
      # npm:@pkg#file → tarball fetch + extract path
      local rest pkg file tarball_url
      rest="${url#npm:}"
      pkg="${rest%%#*}"
      file="${rest#*#}"
      if [ -z "$pkg" ] || [ -z "$file" ] || [ "$pkg" = "$rest" ]; then
        echo "ERROR: malformed npm: URL (expected npm:<pkg>#<file>): $url" >&2
        exit 1
      fi
      if ! tarball_url=$(npm view "$pkg" dist.tarball 2>"$WORK_DIR/npm.err"); then
        echo "ERROR: failed to resolve tarball URL for $pkg via npm view" >&2
        sed 's/^/  npm: /' "$WORK_DIR/npm.err" >&2 || true
        exit 1
      fi
      if [ -z "$tarball_url" ]; then
        echo "ERROR: npm view returned empty tarball URL for $pkg" >&2
        exit 1
      fi
      if ! curl -fSL "$tarball_url" -o "$WORK_DIR/$slug.tgz" 2>"$WORK_DIR/curl.err"; then
        echo "ERROR: failed to fetch tarball for $pkg from $tarball_url" >&2
        sed 's/^/  curl: /' "$WORK_DIR/curl.err" >&2 || true
        exit 1
      fi
      if ! tar -xzOf "$WORK_DIR/$slug.tgz" "$file" > "$out" 2>"$WORK_DIR/tar.err"; then
        echo "ERROR: failed to extract $file from tarball for $pkg" >&2
        sed 's/^/  tar: /' "$WORK_DIR/tar.err" >&2 || true
        exit 1
      fi
      if [ ! -s "$out" ]; then
        echo "ERROR: extracted $file is empty (pkg=$pkg)" >&2
        exit 1
      fi
      rm -f "$WORK_DIR/$slug.tgz"
    else
      # Plain http(s) — direct curl.
      if ! curl -fSL "$url" -o "$out" 2>"$WORK_DIR/curl.err"; then
        echo "ERROR: failed to fetch upstream: $description" >&2
        echo "  source: $url" >&2
        sed 's/^/  curl: /' "$WORK_DIR/curl.err" >&2 || true
        exit 1
      fi
    fi
    i=$((i + 1))
  done
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

  local i=0
  local count
  count="$(printf '%s' "$SOURCES_JSON" | jq -r '.sources | length')"
  local drift_count=0

  while [ "$i" -lt "$count" ]; do
    local description url pack_display slug current_hex baseline_path expected_hex
    description="$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].description")"
    url="$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].url")"
    pack_display="$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].packDisplayName")"
    slug="$(slug_for "$description")"
    current_hex="$(compute_sha256 "$WORK_DIR/$slug.body")"
    baseline_path="$baseline_dir/$slug.sha256"
    if [ ! -f "$baseline_path" ]; then
      printf 'DRIFT: %s pack=%s method=upstreamSources baseline=MISSING current=%s... source=%s\n' \
        "$description" "$pack_display" "${current_hex:0:8}" "$url"
      drift_count=$((drift_count + 1))
    else
      expected_hex="$(read_baseline_hash "$baseline_path")"
      if [ "$expected_hex" != "$current_hex" ]; then
        printf 'DRIFT: %s pack=%s method=upstreamSources baseline=%s... current=%s... source=%s\n' \
          "$description" "$pack_display" "${expected_hex:0:8}" "${current_hex:0:8}" "$url"
        drift_count=$((drift_count + 1))
      fi
    fi
    i=$((i + 1))
  done

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

  local date_dir
  date_dir="$SNAPSHOTS_DIR/$(date -u +%Y-%m-%d)"
  mkdir -p "$date_dir"

  local i=0
  local count
  count="$(printf '%s' "$SOURCES_JSON" | jq -r '.sources | length')"
  {
    echo "Wrote baselines to: $date_dir"
  } >&2
  while [ "$i" -lt "$count" ]; do
    local description slug current_hex
    description="$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].description")"
    slug="$(slug_for "$description")"
    current_hex="$(compute_sha256 "$WORK_DIR/$slug.body")"
    # sha256sum-output format: <hex><two spaces><filename>.
    printf '%s  %s\n' "$current_hex" "$slug.body" > "$date_dir/$slug.sha256"
    {
      printf '  %-40s = %s\n' "$slug.sha256" "$current_hex"
    } >&2
    i=$((i + 1))
  done

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
