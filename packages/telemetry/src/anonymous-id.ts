import { randomUUID } from 'node:crypto';

export function generateAnonymousId(): string {
  return randomUUID();
}

export function isValidAnonymousId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
