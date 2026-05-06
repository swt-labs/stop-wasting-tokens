export const EXIT = {
  SUCCESS: 0,
  USAGE_ERROR: 1,
  NOT_IMPLEMENTED: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
