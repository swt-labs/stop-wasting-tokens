---
adr: 009
title: POSIX-style paths internally; 200-char cap; forced LF line endings
status: Proposed
decided: 2026-05-11
pr: M3 PR-30
supersedes: TDD2 §9.3
related: ADR-008
---

# ADR-009 — POSIX-style paths internally; 200-char cap; forced LF line endings

**Status:** Proposed (promotes to Accepted when M3 PR-30 lands the implementation)

## Context

git-worktree on Windows surfaces three failure classes that are not present
on macOS or Linux:

1. **Case-insensitive filesystem collisions** — `Logger.ts` and `logger.ts`
   collide; git treats them as distinct, the FS doesn't. Worktree creation
   on a path containing a case-sensitive variant of an existing entry fails
   silently with the wrong tree.
2. **MAX_PATH (~260 characters)** — the legacy Win32 path API tops out at
   260 chars (extensible via long-path manifest on Win10+, but not
   universally honoured by every shell + git toolchain). `.swt-planning/
parallel/wt-<task-id>/` is already 30+ chars before any project path
   joins; deeply-nested test fixtures blow past 260 fast.
3. **CRLF/LF mismatch** — Windows defaults to CRLF on checkout; tooling
   downstream (Prettier, eslint, the cassette format's exact-bytes hashing)
   trips on CRLF when LF is the source of truth.

M3 ships worktree-per-task (ADR-008). Without explicit discipline, the M1
Linux/macOS CI matrix is green while Windows users hit cryptic
"path too long" / "file already exists (different case)" / "diff -r dist-first
dist returns whitespace-only changes" failures.

## Decision

Three rules applied at the orchestration layer:

1. **POSIX path discipline.** All paths stored and compared internally are
   POSIX-form (`/`-separated). Conversion to Win32 form (`\` + drive letter)
   happens only at the `child_process.spawn` boundary in `runtime/src/probe.ts`
   and `runtime/src/tools.ts`. The shared `pathUtil.posix()` helper does the
   conversion both ways.
2. **200-character cap.** Worktree paths (cwd + task ID prefix) are capped
   at 200 chars at creation time; the dispatcher fails fast with a clear
   message ("worktree path would exceed 200 chars on Windows: <path>")
   rather than letting git die opaquely. 200 leaves 60 chars of headroom
   for the project's deepest file path inside the worktree.
3. **Forced LF line endings.** Each worktree gets a `.gitattributes` file
   containing `* text=auto eol=lf` on creation. The cassette format's
   exact-bytes hashing depends on LF; reproducible builds (ADR-010)
   depend on it; Prettier configuration enforces it. One declaration,
   three benefits.

The ESLint rule `no-restricted-syntax` enforces "no `path.win32.*` outside
the boundary modules" — developers can't accidentally write native paths
in orchestration logic.

## Consequences

Easier:

- Chaos test suite (M3 PR-28) runs on Windows runners without OS-specific
  skips. The 6-OS CI matrix stays uniform.
- The 200-char cap fails fast with a readable error, not git's "fatal:
  could not lock config file" surface.
- LF discipline cascades: cassette hashing stays deterministic; Prettier
  doesn't fight git; ADR-010 reproducible builds stay reproducible.

Harder:

- Path arithmetic adds an abstraction layer. `pathUtil.posix()` is one
  function; discipline enforced by ESLint + review.
- Developers writing native paths in tests needs the ESLint rule. Adding
  it is a one-line change; auditing existing tests at M3 PR-30 is ~10
  fixture-path edits.
