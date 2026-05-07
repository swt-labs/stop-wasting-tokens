export { TelemetryClient, type TelemetryClientOptions } from './client.js';
export { type Sender, NoopSender, TestSender } from './sender.js';
export { HttpSender, type HttpSenderOptions } from './http-sender.js';
export {
  type EventName,
  type EventProperties,
  type TelemetryEvent,
  ALLOWED_KEYS,
} from './events.js';
export { sanitize, type SanitizeOptions } from './sanitize.js';
export { generateAnonymousId, isValidAnonymousId } from './anonymous-id.js';

export const PACKAGE_NAME = '@swt-labs/telemetry';
export const VERSION = '0.0.0';
