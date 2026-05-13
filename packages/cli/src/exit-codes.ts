export const EXIT = {
  SUCCESS: 0,
  USAGE_ERROR: 1,
  NOT_IMPLEMENTED: 2,
  RUNTIME_ERROR: 3,
  // Plan 04-01 T4 — translates CookCancelledError (user wrote 'cancel' to
  // .swt-planning/.cook-controls/{sessionId}.pending while cook was
  // paused at a mode boundary) to a clean orchestrator exit. Distinct
  // from RUNTIME_ERROR so the dashboard / CI can tell "user aborted"
  // from "spawn failed".
  USER_CANCELLED: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
