#!/usr/bin/env bash
# swt-cache-key.sh — shared cache-root + workspace-scoped /tmp cache helpers.
#
# SWT_CACHE_ROOT convention (Phase 2 plan 02-04 Decision 4)
# =========================================================
# Default: ${HOME}/.swt/cache — XDG-ish local per-user cache root.
# Override: export SWT_CACHE_ROOT=/path/before sourcing this file (e.g.
#           ~/.npm/swt for npm-co-located caching, or a per-test tmpdir).
#
# Mirrors VBW's ${CLAUDE_CONFIG_DIR}/plugins/cache/vbw-marketplace/vbw semantics
# (local per-user, NOT project-relative). Use .swt-planning/ for project state
# instead — the cache here is for shared, user-wide artifacts that survive
# project deletion (e.g. downloaded model artefacts, prebuilt index data).
#
# Layout assumption: directories directly under SWT_CACHE_ROOT are independent
# cache buckets. cache-nuke.sh wipes the whole root (default) or keeps the
# newest bucket (--keep-latest). Per-package / per-version key derivation is a
# Phase 6 concern when SWT actually populates the cache.

# Idempotent source guard.
if [ "${_SWT_CACHE_KEY_SOURCED:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi
_SWT_CACHE_KEY_SOURCED=1

swt_cache_root() {
  printf '%s' "${SWT_CACHE_ROOT:-${HOME}/.swt/cache}"
}

vbw_hash_path() {
  local root="$1"
  if command -v md5sum &>/dev/null; then
    printf '%s' "$root" | md5sum | cut -c1-8
  elif command -v md5 &>/dev/null; then
    printf '%s' "$root" | md5 -q | cut -c1-8
  else
    printf '%s' "$root" | cksum | cut -d' ' -f1
  fi
}

vbw_cache_prefix() {
  local version="$1" uid="$2" root="$3"
  local hash
  hash=$(vbw_hash_path "$root")
  printf '/tmp/swt-%s-%s-%s' "${version:-0}" "$uid" "$hash"
}
