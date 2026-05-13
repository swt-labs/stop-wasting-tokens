#!/usr/bin/env bash
set -euo pipefail

# bulk-sed-bats-rename.sh — Plan 06-05 T2 mechanical migration.
#
# Renames stale v2-era tokens in testing/verify-*.sh fixtures to their
# v3 production equivalents. Each substitution mirrors a migration that
# already happened in production source (agents/, commands/, scripts/,
# packages/) but was missed in the test fixtures.
#
# Survey reference: .vbw-planning/phases/06-hardening/06-05-PLAN.md §T1.
# Target: ~33 contract tests failing → measurable parity lift (Phase 3
# PARITY-REPORT.md:143 sized this as 29.4% → ~82%).
#
# What this script does NOT rename:
#   * VBW_PLANNING_DIR, VBW_AGENT_ROLE, VBW_CONFIG_ROOT, VBW_*  env vars
#     are still set by production scripts as legacy aliases (see
#     packages/runtime/src/hooks/dispatcher.ts:76-77). Test fixtures
#     exercising those aliases stay as-is.
#   * vbw-marketplace plugin name (real production plugin slug)
#   * vbw-debug-target.txt filename (real gitignored marker)
#   * Free-text comments referring to "VBW-era" / "Migrated from VBW"
#     (historical commentary)
#
# Usage:
#   bash scripts/bulk-sed-bats-rename.sh            # apply (idempotent)
#   bash scripts/bulk-sed-bats-rename.sh --dry-run  # show diff only
#
# Idempotent: re-running produces no further changes.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  '' ) ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 64 ;;
esac

# macOS BSD sed needs `-i ''` (with space); GNU sed accepts `-i` alone.
# Detect by checking `sed --version` (GNU prints version; BSD errors).
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(sed -i)
else
  SED_INPLACE=(sed -i '')
fi

TARGETS=( testing/verify-*.sh )

apply() {
  local pattern="$1"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY: sed -E -e '$pattern'  (targets: ${#TARGETS[@]} files)"
  else
    "${SED_INPLACE[@]}" -E -e "$pattern" "${TARGETS[@]}"
  fi
}

# ── 1. Agent file references: vbw-{role}.md → swt-{role}.md ──────────────
# Production: agents/swt-scout.md, swt-architect.md, swt-lead.md, swt-dev.md,
# swt-qa.md, swt-debugger.md, swt-docs.md.
# POSIX-portable boundary (BSD sed has no \b): use [^a-zA-Z0-9_-] class.
apply 's#(^|[^a-zA-Z0-9_-])vbw-(scout|architect|lead|dev|qa|debugger|docs)\.md#\1swt-\2.md#g'

# ── 2. Bare agent role tokens in test commentary: "vbw-dev.md:", etc. ──
# Already covered by #1, but also handle non-.md trailing forms used in
# comments + diagnostics. Conservative — only role-suffix forms.
apply 's#(^|[^a-zA-Z0-9_-])vbw-(scout|architect|lead|dev|qa|debugger|docs)([^a-zA-Z0-9_-]|$)#\1swt-\2\3#g'

# ── 3. Commands namespace: vbw:foo → swt:foo ─────────────────────────────
# Production frontmatter (e.g. commands/compress.md): `name: swt:compress`.
apply 's#(^|[^a-zA-Z0-9_-])vbw:#\1swt:#g'

# ── 4. commands/vibe.md → commands/cook.md ───────────────────────────────
# Production: commands/cook.md exists; vibe.md was renamed at v3.0.0-alpha.3.
apply 's#commands/vibe\.md#commands/cook.md#g'

# ── 5. /tmp diag-report path: vbw-diag-report-${CLAUDE_SESSION_ID} → swt-diag-report-${SWT_SESSION_ID} ──
# Production: commands/report.md uses /tmp/swt-diag-report-${SWT_SESSION_ID:-default}.txt.
apply 's#vbw-diag-report-\$\{CLAUDE_SESSION_ID#swt-diag-report-${SWT_SESSION_ID#g'

# ── 6. /tmp plugin-root-link path: .vbw-plugin-root-link-${CLAUDE_SESSION_ID} → .swt-install-root-link-${SWT_SESSION_ID} ──
# Production: commands/config.md:318, commands/init.md:172/466, commands/debug.md, commands/verify.md
# all use /tmp/.swt-install-root-link-${SWT_SESSION_ID:-default}/scripts/planning-git.sh.
apply 's#\.vbw-plugin-root-link-\$\{CLAUDE_SESSION_ID#.swt-install-root-link-${SWT_SESSION_ID#g'

# ── 7. .vbw-planning test setup dirs → .swt-planning ─────────────────────
# Production: file-guard.sh, state-updater.sh, all agents (swt-dev.md etc.)
# reference .swt-planning. Test fixtures that build .vbw-planning trees are
# exercising paths the scripts no longer recognize as a SWT project.
# Note: a small number of tests legitimately test the legacy `.vbw-planning`
# *path string* as backwards-compat input (e.g. agent-spawn-guard tests). Those
# will surface in the diff; hand-revert if needed.
apply 's#\.vbw-planning#.swt-planning#g'

# ── 8. CLAUDE_SESSION_ID → SWT_SESSION_ID in test fixtures ───────────────
# Only when paired with the patterns above; we already handled the two
# concrete /tmp pattern callsites in #5 and #6. Any stragglers (bare env
# var references in test fixtures that mirror production behavior) need
# inspection — defer to a post-sed diff scan.

# ── 9. CLAUDE_SESSION_ID stragglers (bare references in stub bodies) ─────
# Production hook scripts read SWT_SESSION_ID (see packages/runtime/src/
# hooks/dispatcher.ts:42). Mirror in fixtures.
apply 's#(^|[^a-zA-Z0-9_])CLAUDE_SESSION_ID([^a-zA-Z0-9_]|$)#\1SWT_SESSION_ID\2#g'

echo "bulk-sed-bats-rename: completed ${#TARGETS[@]} files"
