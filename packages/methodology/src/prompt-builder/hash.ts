import { createHash } from 'node:crypto';

/**
 * SHA-256 hex digest of the cache-friendly static prefix. Caller asserts
 * stability across sessions for a given config by checking that this digest
 * is unchanged.
 */
export function hashPrefix(prefix: string): string {
  return createHash('sha256').update(prefix, 'utf8').digest('hex');
}
