import type { PermissionProfile } from '@swt-labs/core';

import { emitToml } from './emit.js';

export function emitPermissionToml(profile: PermissionProfile): string {
  return emitToml({
    permissions: {
      [profile.name]: {
        sandbox_mode: profile.sandbox_mode,
        approval_policy: profile.approval_policy,
        writable_roots: [...profile.writable_roots],
      },
    },
  });
}
