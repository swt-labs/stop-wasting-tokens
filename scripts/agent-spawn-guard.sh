#!/usr/bin/env bash
set -u
# agent-spawn-guard.sh — Phase 2 §6.3 STUB (Decision 2).
#
# Pi 0.74's PreToolUse intercept is advisory only. The dispatcher
# (packages/runtime/src/hooks/dispatcher.ts lines 18-66) documents this:
# `TOOL_CALL` events arrive as post-notifications, so an `exit 2` here
# logs the would-be-block but cannot actually unwind a tool call Pi has
# already forwarded to the agent.
#
# The REAL spawn-validation gate lives in TypeScript: see
# packages/orchestration/src/spawn-agent.ts — it validates role, tool
# subsets, worktree cwd, and team_name semantics BEFORE any Pi tool
# fires. Bash policy logic at this layer would be cosmetic until Pi
# exposes a synchronous pre-execution hook.
#
# TODO(Phase F): when Pi exposes a real pre-execution intercept (TDD3
# §8.2 + research §7 risk 1, anchored at dispatcher.ts:18-66), revisit
# this stub — either restore the bash-side policy or wire the TypeScript
# gate through PreToolUse with proper blocking semantics.
#
# Body: drain stdin (avoid SIGPIPE on the dispatcher writer), log the
# advisory pass-through, exit 0.

# Read + discard stdin to avoid SIGPIPE on the dispatcher write side.
cat >/dev/null 2>&1 || true

PLANNING_DIR="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"
if [ -d "$PLANNING_DIR" ]; then
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown')
  printf '[%s] agent-spawn-guard: advisory pass-through (Phase F)\n' "$TS" \
    >> "$PLANNING_DIR/.hook-errors.log" 2>/dev/null || true
fi

exit 0
