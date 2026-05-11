/**
 * Cwd-scoped re-exports of Pi's tool factories. Each call returns a fresh
 * `AgentTool[]` rooted at the supplied cwd, so worktrees (M3) and per-task
 * sessions get independent tool sets.
 *
 * Pi's factory list per TDD2 §5.3 / Appendix A.1:
 *   createCodingTools, createReadOnlyTools, createRead/Bash/Edit/Write/Grep/Find/Ls Tool.
 *
 * PR-02 only re-exports the bundled-factory pair `createCodingTools` /
 * `createReadOnlyTools`; per-tool factories (createReadTool etc.) are added
 * lazily when a concrete role needs the finer granularity. The Result Protocol
 * custom tool (`swt_report_result`) is registered via Pi's Extension API in
 * Plan 01-02 PR-09 — not here.
 */

import {
  createCodingTools as piCreateCodingTools,
  createReadOnlyTools as piCreateReadOnlyTools,
} from '@earendil-works/pi-coding-agent';

export function createCodingTools(cwd: string): ReturnType<typeof piCreateCodingTools> {
  return piCreateCodingTools(cwd);
}

export function createReadOnlyTools(cwd: string): ReturnType<typeof piCreateReadOnlyTools> {
  return piCreateReadOnlyTools(cwd);
}
