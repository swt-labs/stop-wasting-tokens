#!/usr/bin/env bash
# DEPRECATED — SWT resolves SWT_INSTALL_ROOT via env (applyEnvToProcess in
# packages/runtime/src/env.ts), not via session-symlinks. This stub remains only
# for compatibility with the 26 command files (commands/*.md) that still
# contain the CC-era session-symlink resolution preamble. Phase 3 will clean
# those commands and DELETE this script.
#
# Reference: TDD3 §3; Phase 2 plan 02-04 Decision 3.
set -u
# Read + discard stdin to avoid SIGPIPE on piped callers.
cat >/dev/null 2>&1 || true
exit 0
