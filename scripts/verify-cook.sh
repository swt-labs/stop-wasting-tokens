#!/usr/bin/env bash
set -euo pipefail

# verify-cook.sh — Automated verification of the cook command consolidation.
#
# Checks the cook router/mode consolidation requirements (REQ-01 through REQ-25)
# across 6 groups. Read-only: never modifies any files.
#
# Renamed from verify-vibe.sh: commands/vibe.md was renamed to commands/cook.md
# at v3.0.0-alpha.3; this test is repointed at the v3 cook command surface.
#
# Usage: bash scripts/verify-cook.sh
# Exit: 0 if all pass, 1 if any fail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

COOK="$ROOT/commands/cook.md"
PROTOCOL="$ROOT/references/execute-protocol.md"
README="$ROOT/README.md"
CLAUDE_MD="$ROOT/CLAUDE.md"
HELP="$ROOT/commands/help.md"
SUGGEST="$ROOT/scripts/suggest-next.sh"
MKT_ROOT="$ROOT/marketplace.json"
MKT_PLUGIN="$ROOT/.claude-plugin/marketplace.json"

tracked_repo_file_exists() {
  git -C "$ROOT" ls-files --error-unmatch "$1" >/dev/null 2>&1
}

tracked_markdown_count() {
  git -C "$ROOT" ls-files -- "$@" | wc -l | tr -d ' '
}

# Counters
TOTAL_PASS=0
TOTAL_FAIL=0
GROUP_PASS=0
GROUP_FAIL=0

# --- Helpers ---

group_start() {
  GROUP_PASS=0
  GROUP_FAIL=0
  echo ""
  echo "=== $1 ==="
}

group_end() {
  local label="$1"
  TOTAL_PASS=$((TOTAL_PASS + GROUP_PASS))
  TOTAL_FAIL=$((TOTAL_FAIL + GROUP_FAIL))
  if [ "$GROUP_FAIL" -eq 0 ]; then
    echo "  >> $label: ALL PASS ($GROUP_PASS checks)"
  else
    echo "  >> $label: $GROUP_FAIL FAIL, $GROUP_PASS pass"
  fi
}

check() {
  local req="$1"
  local desc="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then
    echo "  PASS  $req: $desc"
    GROUP_PASS=$((GROUP_PASS + 1))
  else
    echo "  FAIL  $req: $desc"
    GROUP_FAIL=$((GROUP_FAIL + 1))
  fi
}

check_absent() {
  local req="$1"
  local desc="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then
    echo "  FAIL  $req: $desc"
    GROUP_FAIL=$((GROUP_FAIL + 1))
  else
    echo "  PASS  $req: $desc"
    GROUP_PASS=$((GROUP_PASS + 1))
  fi
}

# --- GROUP 1: Core Router (REQ-01 to REQ-05) ---

group_start "GROUP 1: Core Router (REQ-01 to REQ-05)"

# REQ-01: State detection table
check "REQ-01" "cook.md contains planning_dir_exists" grep -q "planning_dir_exists" "$COOK"
check "REQ-01" "cook.md contains phase_count=0" grep -q "phase_count=0" "$COOK"
check "REQ-01" "cook.md contains next_phase_state" grep -q "next_phase_state" "$COOK"

# REQ-02: NL intent parsing section
check "REQ-02" "cook.md has Natural language intent section" grep -q "Natural language intent" "$COOK"
check "REQ-02" "cook.md has interpret user intent" grep -q "interpret user intent" "$COOK"

# REQ-03: Flags map to modes
check "REQ-03" "cook.md maps --plan to Plan mode" grep -q "\-\-plan.*Plan mode" "$COOK"
check "REQ-03" "cook.md maps --execute to Execute mode" grep -q "\-\-execute.*Execute mode" "$COOK"
check "REQ-03" "cook.md maps --discuss to Discuss mode" grep -q "\-\-discuss.*Discuss mode" "$COOK"

# REQ-04: Confirmation gate via AskUserQuestion
check "REQ-04" "cook.md references AskUserQuestion" grep -q "AskUserQuestion" "$COOK"

# REQ-05: --yolo skip behavior
check "REQ-05" "cook.md describes --yolo flag" grep -q "\-\-yolo" "$COOK"
check "REQ-05" "cook.md describes --yolo skipping confirmations" grep -q "skip.*confirmation" "$COOK"

group_end "Core Router"

# --- GROUP 2: Mode Implementation (REQ-06 to REQ-15) ---

group_start "GROUP 2: Mode Implementation (REQ-06 to REQ-15)"

# Mode headers present in the v3 cook.md mode surface
check "REQ-06" "Mode: Init Redirect header" grep -q "### Mode: Init Redirect" "$COOK"
check "REQ-06" "Mode: Bootstrap header" grep -q "### Mode: Bootstrap" "$COOK"
check "REQ-07" "Mode: Scope header" grep -q "### Mode: Scope" "$COOK"
check "REQ-10" "Mode: Discuss header" grep -q "### Mode: Discuss" "$COOK"
check "REQ-11" "Mode: Assumptions header" grep -q "### Mode: Assumptions" "$COOK"
check "REQ-08" "Mode: Plan header" grep -q "### Mode: Plan" "$COOK"
check "REQ-09" "Mode: Execute header" grep -q "### Mode: Execute" "$COOK"
check "REQ-12" "Mode: Add Phase header" grep -q "### Mode: Add Phase" "$COOK"
check "REQ-13" "Mode: Insert Phase header" grep -q "### Mode: Insert Phase" "$COOK"
check "REQ-14" "Mode: Remove Phase header" grep -q "### Mode: Remove Phase" "$COOK"
check "REQ-15" "Mode: Archive header" grep -q "### Mode: Archive" "$COOK"

# REQ-06: Bootstrap mentions PROJECT.md
check "REQ-06" "Bootstrap references PROJECT.md" grep -q "PROJECT.md" "$COOK"

# REQ-09: Execute mode references execute-protocol.md
check "REQ-09" "Execute mode references execute-protocol.md" grep -q "execute-protocol.md" "$COOK"

# REQ-15: Archive mode contains audit checks
check "REQ-15" "Archive mode has audit matrix" grep -q "audit" "$COOK"

group_end "Mode Implementation"

# --- GROUP 3: Execution Protocol (REQ-16, REQ-17) ---

group_start "GROUP 3: Execution Protocol (REQ-16, REQ-17)"

# REQ-16: execute-protocol.md in references/ (not commands/)
check "REQ-16" "execute-protocol.md exists in references/" test -f "$PROTOCOL"
check_absent "REQ-16" "execute-protocol.md NOT in commands/" tracked_repo_file_exists "commands/execute-protocol.md"

# REQ-16: No command frontmatter (no name: line)
check_absent "REQ-16" "execute-protocol.md has no name: frontmatter" grep -q "^name:" "$PROTOCOL"

# REQ-16: Contains Steps 2-5
check "REQ-16" "execute-protocol.md contains Step 2" grep -q "Step 2" "$PROTOCOL"
check "REQ-16" "execute-protocol.md contains Step 3" grep -q "Step 3" "$PROTOCOL"
check "REQ-16" "execute-protocol.md contains Step 4" grep -q "Step 4" "$PROTOCOL"
check "REQ-16" "execute-protocol.md contains Step 5" grep -q "Step 5" "$PROTOCOL"

# REQ-17: Execute mode uses conditional Read for protocol
check "REQ-17" "cook.md Execute mode reads execute-protocol.md" grep -q "Read.*execute-protocol" "$COOK"

group_end "Execution Protocol"

# --- GROUP 4: Command Surface (REQ-18 to REQ-20) ---

group_start "GROUP 4: Command Surface (REQ-18 to REQ-20)"

# REQ-18: 9 absorbed commands do NOT exist
ABSORBED=(implement plan execute assumptions add-phase insert-phase remove-phase archive audit)
for cmd in "${ABSORBED[@]}"; do
  check_absent "REQ-18" "commands/${cmd}.md does not exist" tracked_repo_file_exists "commands/${cmd}.md"
done

# REQ-18: Exact tracked file count (ignore ignored/untracked local command artifacts)
CMD_COUNT=$(tracked_markdown_count 'commands/*.md')
check "REQ-18" "commands/ has exactly 26 .md files (found $CMD_COUNT)" test "$CMD_COUNT" -eq 26

# REQ-20: No stale "29 commands" in key files
check_absent "REQ-20" "README.md has no '29 commands'" grep -q "29 commands" "$README"
check_absent "REQ-20" "marketplace.json has no '29 commands'" grep -q "29 commands" "$MKT_ROOT"
check_absent "REQ-20" ".claude-plugin/marketplace.json has no '29 commands'" grep -q "29 commands" "$MKT_PLUGIN"

# REQ-20: No swt implement in key files
check_absent "REQ-20" "suggest-next.sh has no swt implement" grep -q "swt implement" "$SUGGEST"
check_absent "REQ-20" "help.md has no swt implement" grep -q "swt implement" "$HELP"
check_absent "REQ-20" "README.md has no swt implement" grep -q "swt implement" "$README"
check_absent "REQ-20" "CLAUDE.md has no swt implement" grep -q "swt implement" "$CLAUDE_MD"

# REQ-20: Positive checks — key files reference swt cook
check "REQ-20" "suggest-next.sh references swt cook" grep -q "swt cook" "$SUGGEST"

group_end "Command Surface"

# --- GROUP 5: NL Parsing (REQ-21, REQ-22) ---

group_start "GROUP 5: NL Parsing (REQ-21, REQ-22)"

# REQ-21: NL parsing is prompt-only (no regex, no import)
check_absent "REQ-21" "cook.md has no regex patterns" grep -q "regex" "$COOK"
check_absent "REQ-21" "cook.md has no import statements" grep -q "^import " "$COOK"
check "REQ-21" "cook.md has keyword-based intent matching" grep -q "keywords" "$COOK"

# REQ-22: Ambiguous intents handled
check "REQ-22" "cook.md handles ambiguous intents" grep -q "Ambiguous" "$COOK"
check "REQ-22" "cook.md routes ambiguity to contextual AskUserQuestion flow" grep -q "Ambiguous -> AskUserQuestion with contextual options" "$COOK"

group_end "NL Parsing"

# --- GROUP 6: Flags (REQ-23 to REQ-25) ---

group_start "GROUP 6: Flags (REQ-23 to REQ-25)"

# REQ-23: Count unique mode flags (should be >= 9)
FLAG_COUNT=$(grep -c "^\- \`--" "$COOK" || true)
check "REQ-23" "cook.md has >= 9 mode flags (found $FLAG_COUNT)" test "$FLAG_COUNT" -ge 9

# REQ-24: Behavior modifiers present
check "REQ-24" "cook.md has --effort modifier" grep -q "\-\-effort" "$COOK"
check "REQ-24" "cook.md has --skip-qa modifier" grep -q "\-\-skip-qa" "$COOK"
check "REQ-24" "cook.md has --skip-audit modifier" grep -q "\-\-skip-audit" "$COOK"
check "REQ-24" "cook.md has --plan=NN modifier" grep -q "\-\-plan=NN" "$COOK"

# REQ-25: Bare integer support
check "REQ-25" "cook.md documents bare integer support" grep -qi "bare integer" "$COOK"
check "REQ-25" "cook.md bare integer targets phase N" grep -q "phase N" "$COOK"

group_end "Flags"

# --- Summary ---

echo ""
echo "==============================="
echo "  TOTAL: $TOTAL_PASS PASS, $TOTAL_FAIL FAIL"
echo "==============================="

if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  All checks passed."
  exit 0
else
  echo "  Some checks failed."
  exit 1
fi
