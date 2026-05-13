#!/usr/bin/env bash
#
# TDD3 Phase 0 — Bulk port of VBW assets into SWT.
#
# Per TDD3 §23: copies agents/, commands/, templates/, references/, scripts/,
# config/, testing/ from the VBW source tree into the SWT repo root, applies
# the rename pass (§23.2), drops the §6.4 scripts, and flags the §6.3 scripts
# in scripts/.port-rewrites.json for manual rewrite in Phase B.
#
# Idempotent: safe to re-run. Existing SWT-owned files are not overwritten
# (collisions are listed at the end).
#
# Usage:
#   bash scripts/internal/port-from-vbw.sh [--source PATH] [--dry-run]
#
# Defaults source to a_non_production_files/vibe-better-with-claude-code-vbw-main/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SOURCE="a_non_production_files/vibe-better-with-claude-code-vbw-main"
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ ! -d "$SOURCE" ]; then
  echo "VBW source not found at: $SOURCE" >&2
  exit 1
fi

say() { printf '%s\n' "$*"; }
do_run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
  else
    # cp -n on BSD/macOS exits 1 when target exists; treat as benign.
    eval "$@" || true
  fi
}

# ---------------------------------------------------------------------------
# TDD3 §6.4 — drop list (do NOT copy)
# ---------------------------------------------------------------------------
DROP_SCRIPTS=(
  "migrate-config.sh"
  "post-discord-release.sh"
  "adopt-contributor-pr.sh"
  "migrate-orphaned-state.sh"
)

# ---------------------------------------------------------------------------
# TDD3 §6.3 — copy but flag for manual rewrite in Phase B (Claude-specific)
# ---------------------------------------------------------------------------
REWRITE_SCRIPTS=(
  "clean-stale-teams.sh"
  "agent-pid-tracker.sh"
  "agent-spawn-guard.sh"
  "agent-start.sh"
  "agent-stop.sh"
  "lease-lock.sh"
  "tmux-watchdog.sh"
  "compaction-instructions.sh"
  "post-compact.sh"
)

# ---------------------------------------------------------------------------
# Existing SWT files we must NOT overwrite during the script merge
# ---------------------------------------------------------------------------
SCRIPT_COLLISIONS_KEEP_SWT=(
  "bump-version.sh"
)

# ---------------------------------------------------------------------------
# Top-level files we explicitly do NOT copy (per TDD3 §23.1)
# ---------------------------------------------------------------------------
SKIP_TOPLEVEL=(
  "CLAUDE.md" "AGENTS.md" "README.md" "CHANGELOG.md" "CONTRIBUTING.md"
  "LICENSE" "VERSION" "marketplace.json"
  ".gitignore" ".markdownlint.json" ".prettierignore" ".shellcheckrc"
)

is_in() {
  local needle=$1; shift
  local item
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Step 1: Mirror directory structures
# ---------------------------------------------------------------------------
say "→ Copying VBW directories into SWT root..."

# agents/ — copy all .md, rename vbw- → swt-
mkdir -p agents
for src in "$SOURCE/agents/"*.md; do
  base=$(basename "$src")
  dst="agents/${base/vbw-/swt-}"
  do_run "cp -n '$src' '$dst'"
done

# commands/ — copy all .md (filenames unchanged except vibe.md → cook.md)
mkdir -p commands
for src in "$SOURCE/commands/"*.md; do
  base=$(basename "$src")
  if [ "$base" = "vibe.md" ]; then
    dst="commands/cook.md"
  else
    dst="commands/$base"
  fi
  do_run "cp -n '$src' '$dst'"
done

# templates/ — copy verbatim (no rename, no body rewrite)
mkdir -p templates
for src in "$SOURCE/templates/"*.md; do
  base=$(basename "$src")
  do_run "cp -n '$src' 'templates/$base'"
done

# references/ — copy + rename vbw-brand-essentials.md → swt-brand-essentials.md
mkdir -p references
for src in "$SOURCE/references/"*.md; do
  base=$(basename "$src")
  dst="references/${base/vbw-/swt-}"
  do_run "cp -n '$src' '$dst'"
done

# config/ — copy verbatim (model-profiles.json gets §23.4 hand-edit later)
mkdir -p config/schemas
for src in "$SOURCE/config/"*.json "$SOURCE/config/"*.txt; do
  [ -f "$src" ] || continue
  base=$(basename "$src")
  do_run "cp -n '$src' 'config/$base'"
done
for src in "$SOURCE/config/schemas/"*; do
  [ -f "$src" ] || continue
  base=$(basename "$src")
  do_run "cp -n '$src' 'config/schemas/$base'"
done

# testing/ — copy verbatim for parity testing (bats files etc.)
if [ -d "$SOURCE/testing" ]; then
  mkdir -p testing
  do_run "cp -rn '$SOURCE/testing/.' testing/ 2>/dev/null || true"
fi

# scripts/ — selective copy (drop list, collision-skip list, rename vbw-)
mkdir -p scripts/bootstrap scripts/lib
DROPPED=()
COLLISIONS=()
COPIED_SCRIPTS=0
for src in "$SOURCE/scripts/"*.sh; do
  [ -f "$src" ] || continue
  base=$(basename "$src")
  if is_in "$base" "${DROP_SCRIPTS[@]}"; then
    DROPPED+=("$base")
    continue
  fi
  dst_base="${base/vbw-/swt-}"
  if is_in "$dst_base" "${SCRIPT_COLLISIONS_KEEP_SWT[@]}" && [ -f "scripts/$dst_base" ]; then
    COLLISIONS+=("$dst_base")
    continue
  fi
  if [ ! -e "scripts/$dst_base" ]; then
    do_run "cp '$src' 'scripts/$dst_base'"
    COPIED_SCRIPTS=$((COPIED_SCRIPTS+1))
  fi
done
# scripts/bootstrap/
for src in "$SOURCE/scripts/bootstrap/"*; do
  [ -f "$src" ] || continue
  base=$(basename "$src")
  do_run "cp -n '$src' 'scripts/bootstrap/$base'"
done
# scripts/lib/ — rename vbw- → swt-
for src in "$SOURCE/scripts/lib/"*; do
  [ -f "$src" ] || continue
  base=$(basename "$src")
  dst_base="${base/vbw-/swt-}"
  do_run "cp -n '$src' 'scripts/lib/$dst_base'"
done

# ---------------------------------------------------------------------------
# Step 2: Rewrite pass (TDD3 §23.2) on .md + .sh files we just copied
# ---------------------------------------------------------------------------
say "→ Applying TDD3 §23.2 rewrite pass..."

# Build a sed script. Order matters: more specific replacements first.
SED_SCRIPT=$(cat <<'SEDEOF'
s|CLAUDE_PLUGIN_ROOT|SWT_INSTALL_ROOT|g
s|CLAUDE_SESSION_ID|SWT_SESSION_ID|g
s|CLAUDE_CONFIG_DIR|SWT_CONFIG_DIR|g
s|VBW_PLUGIN_ROOT|SWT_INSTALL_ROOT|g
s|VBW_CACHE_ROOT|SWT_CACHE_ROOT|g
s|\.vbw-planning/|.swt-planning/|g
s|/tmp/\.vbw-plugin-root-link-|/tmp/.swt-install-root-link-|g
s|vbw-marketplace/vbw/||g
s|subagent_type: "vbw:vbw-|subagent_type: "swt:swt-|g
s|/vbw:vibe|swt cook|g
s|/vbw:|swt |g
s|vbw-|swt-|g
s|Vibe Better With Claude Code|Stop Wasting Tokens|g
s|VBW:|SWT:|g
s|VBW |SWT |g
s| VBW| SWT|g
SEDEOF
)

# macOS sed needs -i ''; gnu sed needs -i.  Detect.
SED_INPLACE=("-i" "")
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=("-i")  # GNU sed
fi

apply_sed_to() {
  local file=$1
  if [ "$DRY_RUN" -eq 1 ]; then
    say "[dry-run] sed rewrite: $file"
    return
  fi
  sed "${SED_INPLACE[@]}" "$SED_SCRIPT" "$file"
}

# Apply sed to all copied agents/commands/references/scripts files.
while IFS= read -r f; do
  apply_sed_to "$f"
done < <(find agents commands references -type f -name '*.md' 2>/dev/null)

while IFS= read -r f; do
  # Skip the porter script itself.
  case "$f" in scripts/internal/*) continue ;; esac
  # Skip pre-existing SWT-owned scripts (preserve them as-is).
  base=$(basename "$f")
  if [ "$base" = "bump-version.sh" ]; then continue; fi
  case "$base" in
    record-cassette.mjs|check-bundle-size.mjs|stub-test-*.mjs|public-benchmark.mjs|\
    verify-install.sh|check-offline.mjs|docs-gen.ts) continue ;;
  esac
  apply_sed_to "$f"
done < <(find scripts -type f \( -name '*.sh' -o -name '*.awk' \) 2>/dev/null)

# Cook orchestrator frontmatter rename (TDD3 §23.2 final row).
if [ -f commands/cook.md ] && [ "$DRY_RUN" -eq 0 ]; then
  sed "${SED_INPLACE[@]}" 's|^name: vbw:vibe|name: swt:cook|; s|^name: vbw:|name: swt:|' commands/cook.md
fi

# Sweep frontmatter name: lines for other commands (swt: prefix).
for cmd in commands/*.md; do
  [ -f "$cmd" ] || continue
  [ "$DRY_RUN" -eq 1 ] && continue
  sed "${SED_INPLACE[@]}" 's|^name: vbw:|name: swt:|' "$cmd"
done

# ---------------------------------------------------------------------------
# Step 3: Write scripts/.port-rewrites.json (TDD3 §23.3 manifest)
# ---------------------------------------------------------------------------
say "→ Writing scripts/.port-rewrites.json..."
if [ "$DRY_RUN" -eq 0 ]; then
  {
    printf '{\n'
    printf '  "_comment": "TDD3 §6.3 / §23.3 — scripts copied verbatim that need manual rewrite in Phase B. They reference Claude Code-specific affordances (TeamCreate, hook lifecycle, plugin cache) that Pi does not provide.",\n'
    printf '  "rewrite_required": [\n'
    last=$((${#REWRITE_SCRIPTS[@]} - 1))
    for i in "${!REWRITE_SCRIPTS[@]}"; do
      script="${REWRITE_SCRIPTS[$i]}"
      sep=","
      [ "$i" = "$last" ] && sep=""
      printf '    "%s"%s\n' "$script" "$sep"
    done
    printf '  ]\n}\n'
  } > scripts/.port-rewrites.json
fi

# ---------------------------------------------------------------------------
# Step 4: Verification summary (TDD3 §23.7)
# ---------------------------------------------------------------------------
say ""
say "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
say "TDD3 Phase 0 — Bulk port summary"
say "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
agents_n=$(find agents -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
commands_n=$(find commands -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
templates_n=$(find templates -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
refs_n=$(find references -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
scripts_n=$(find scripts -maxdepth 1 -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')
say "  agents/      : $agents_n .md files (expected 7)"
say "  commands/    : $commands_n .md files (expected 26; cook.md present? $([ -f commands/cook.md ] && echo yes || echo NO))"
say "  templates/   : $templates_n .md files (expected 16)"
say "  references/  : $refs_n .md files (expected 16; swt-brand-essentials.md present? $([ -f references/swt-brand-essentials.md ] && echo yes || echo NO))"
say "  scripts/     : $scripts_n .sh files at top (expected ~133 + SWT's pre-existing)"
say "  dropped (§6.4): ${#DROPPED[@]} — ${DROPPED[*]:-none}"
say "  collisions (kept SWT version): ${#COLLISIONS[@]} — ${COLLISIONS[*]:-none}"
say "  rewrite-required list: scripts/.port-rewrites.json (${#REWRITE_SCRIPTS[@]} files)"
say ""

# §23.7 leftover-VBW-identifier check
say "→ §23.7 leftover-identifier check..."
leftover_caplaude=$(grep -rE 'CLAUDE_PLUGIN_ROOT|CLAUDE_SESSION_ID' agents commands references scripts 2>/dev/null | wc -l | tr -d ' ')
leftover_vbw_id=$(grep -rE '\bvbw-(architect|scout|lead|dev|qa|debugger|docs)\b' agents commands references 2>/dev/null | wc -l | tr -d ' ')
say "  CLAUDE_PLUGIN_ROOT/SESSION_ID hits in copied files: $leftover_caplaude (expected 0)"
say "  Live vbw-{role} identifiers in agents/commands/references: $leftover_vbw_id (expected 0)"
say ""
say "✓ Phase 0 port complete. Next: §23.6 TS scaffolding cleanup + scope remaining phases."
