import { isAbsolute, normalize, resolve, sep } from 'node:path';

import type { GuardOutcome } from './bash-guard.js';

export interface FileGuardOptions {
  /** Absolute paths the caller is permitted to write inside (recursively). */
  readonly writable_roots: readonly string[];
  /** Optional CWD used to resolve relative target paths (defaults to process.cwd()). */
  readonly cwd?: string;
}

export function checkWritePath(target: string, opts: FileGuardOptions): GuardOutcome {
  const cwd = opts.cwd ?? process.cwd();
  const absoluteTarget = isAbsolute(target) ? normalize(target) : resolve(cwd, target);
  for (const root of opts.writable_roots) {
    const absoluteRoot = isAbsolute(root) ? normalize(root) : resolve(cwd, root);
    if (absoluteTarget === absoluteRoot) return { decision: 'allow' };
    const rootWithSep = absoluteRoot.endsWith(sep) ? absoluteRoot : `${absoluteRoot}${sep}`;
    if (absoluteTarget.startsWith(rootWithSep)) return { decision: 'allow' };
  }
  return {
    decision: 'block',
    reason: `target is outside any writable root`,
    matched_segment: absoluteTarget,
  };
}
