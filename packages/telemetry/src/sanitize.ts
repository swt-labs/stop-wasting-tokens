import { ALLOWED_KEYS, type EventName, type EventProperties } from './events.js';

export interface SanitizeOptions {
  readonly onWarning?: (msg: string) => void;
}

export function sanitize<E extends EventName>(
  name: E,
  properties: EventProperties[E],
  opts: SanitizeOptions = {},
): Record<string, unknown> {
  const allowed = ALLOWED_KEYS[name];
  const out: Record<string, unknown> = {};
  const stripped: string[] = [];

  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if ((allowed as readonly string[]).includes(key)) {
      out[key] = value;
    } else {
      stripped.push(key);
    }
  }

  if (stripped.length > 0 && opts.onWarning) {
    opts.onWarning(`telemetry: stripped disallowed keys from ${name}: ${stripped.join(', ')}`);
  }

  return out;
}
