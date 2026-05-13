/**
 * Role → tool-subset router per TDD2 §10.4.
 *
 * The dispatcher passes a `role` into session creation; this module returns
 * the tool subset that role is allowed to call. Scout / Architect get
 * read-only; Lead / Dev / Debugger get the full coding-tool set; QA gets
 * read-only + bash so it can run the static-check ladder.
 *
 * Tool subsets come from `@swt-labs/runtime`'s `createCodingTools` /
 * `createReadOnlyTools` factories (Plan 01-01 PR-02). M3 adds worktree-keyed
 * scoping (per ADR-008) — at that point `toolsForRole` takes the worktree
 * path instead of `cwd` and the runtime factories handle the scoping. The
 * shape stays the same.
 */

import { createCodingTools, createReadOnlyTools, type SDLCRole } from '@swt-labs/runtime';

/**
 * Tools handed to a Pi `createAgentSession` call. The exact shape comes from
 * Pi (`AgentTool[]`); at the orchestration layer we treat it as opaque + pass
 * through. Per the Layer 1-only-imports-Pi convention (TDD2 §4.3), the
 * orchestration layer doesn't import `@earendil-works/*`.
 */
export type AgentToolList = ReturnType<typeof createCodingTools>;

export function toolsForRole(role: SDLCRole, cwd: string): AgentToolList {
  switch (role) {
    case 'scout':
    case 'architect':
      return createReadOnlyTools(cwd);
    case 'lead':
    case 'dev':
    case 'debugger':
      return createCodingTools(cwd);
    case 'qa':
      // QA gets read-only + bash. The bash tool is part of the coding set,
      // so we hand the coding set + rely on the QA prompt's discipline to
      // not write. At M3+ we can add a true "qa-bash" factory that emits
      // exactly read-only + bash (no edit). For M2's single-agent path,
      // the prompt-level constraint is sufficient.
      return createCodingTools(cwd);
    case 'docs':
      // Docs agent frontmatter (`agents/swt-docs.md`) allows
      // Read/Grep/Glob/Bash/Write/Edit/LSP/Skill — that's the coding set
      // minus the non-overlapping tools we don't expose. Phase 1 reuses
      // the coding bundle and relies on the prompt to keep edits scoped
      // to documentation files; finer per-tool granularity is Phase F.
      return createCodingTools(cwd);
  }
}

/**
 * Lookup table form for consumers that need the SDLC role list at a glance.
 * Useful for the dashboard's Roles panel + the M2 PR-15 doctor command.
 */
export const ROLE_TOOL_SUBSETS: Readonly<Record<SDLCRole, 'readonly' | 'qa-bash' | 'coding'>> = {
  scout: 'readonly',
  architect: 'readonly',
  lead: 'coding',
  dev: 'coding',
  qa: 'qa-bash',
  debugger: 'coding',
  docs: 'coding',
};
