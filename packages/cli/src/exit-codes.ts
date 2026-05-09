export const EXIT = {
  SUCCESS: 0,
  USAGE_ERROR: 1,
  NOT_IMPLEMENTED: 2,
  RUNTIME_ERROR: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
