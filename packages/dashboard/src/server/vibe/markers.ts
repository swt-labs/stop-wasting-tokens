/**
 * Wire-format markers used to surface "agent wants to ask the user" / "user
 * has replied" across the agent subprocess boundary. Format chosen for
 * survivability — one self-contained line, JSON payload, prefix/suffix
 * unlikely to collide with real agent output.
 *
 *   <<<ASK_USER:{json}>>>      — emitted by the agent on stdout
 *   <<<USER_REPLY:{json}>>>    — written by the daemon to the agent's stdin
 *
 * Per `.vbw-planning/research/v2-agent-prompt-protocol.md`:
 * - Markers are matched anchored to start-of-line (with optional leading
 *   whitespace). A buffered partial line is incomplete until the closing
 *   `>>>` arrives.
 * - JSON payload must parse as an object; on parse failure the marker is
 *   skipped (treated as ordinary stdout).
 * - The marker line itself is consumed — it is NOT forwarded to the log
 *   panel as ordinary stdout.
 */

import { z } from 'zod';

const MARKER_REGEX = /^[ \t]*<<<(ASK_USER|USER_REPLY):(.*)>>>[ \t]*$/;

export type MarkerKind = 'ASK_USER' | 'USER_REPLY';

export interface ParsedMarker {
  kind: MarkerKind;
  payload: Record<string, unknown>;
}

const AskUserPayloadSchema = z.object({
  subtype: z.enum(['clarification', 'permission']),
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .optional(),
  context: z.record(z.unknown()).optional(),
});

const UserReplyPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), value: z.string().min(1) }),
  z.object({ kind: z.literal('free_form'), text: z.string() }),
  z.object({
    kind: z.literal('permission'),
    decision: z.enum(['once', 'session', 'deny']),
    user_note: z.string().optional(),
  }),
  z.object({ kind: z.literal('expired') }),
]);

/**
 * Try to parse a single line as a marker. Returns null if the line is not
 * a marker, or the JSON payload doesn't validate. Callers should treat
 * non-marker lines as ordinary stdout.
 */
export function tryParseMarker(line: string): ParsedMarker | null {
  const match = MARKER_REGEX.exec(line);
  if (!match) return null;
  const kind = match[1] as MarkerKind;
  const rawPayload = match[2] ?? '';
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawPayload);
  } catch {
    return null;
  }
  if (typeof parsedJson !== 'object' || parsedJson === null) return null;
  if (kind === 'ASK_USER') {
    const validated = AskUserPayloadSchema.safeParse(parsedJson);
    if (!validated.success) return null;
    return { kind, payload: validated.data };
  }
  const validated = UserReplyPayloadSchema.safeParse(parsedJson);
  if (!validated.success) return null;
  return { kind, payload: validated.data };
}

/**
 * Format a USER_REPLY marker line. Used by the daemon to write replies to
 * the agent's stdin. Always terminates with `\n` so the agent can consume
 * it line-buffered.
 */
export function formatUserReplyMarker(reply: Record<string, unknown>): string {
  return `<<<USER_REPLY:${JSON.stringify(reply)}>>>\n`;
}

/**
 * Format an ASK_USER marker line. Used by test agents to simulate agent
 * stdout. Real Codex agents emit these via their prompt template.
 */
export function formatAskUserMarker(payload: Record<string, unknown>): string {
  return `<<<ASK_USER:${JSON.stringify(payload)}>>>\n`;
}

/**
 * Buffered line consumer. Accumulates partial chunks of stdout until a
 * newline arrives, then emits each completed line via `onLine`. Marker
 * detection happens line-by-line; non-marker lines are passed through as
 * ordinary stdout via `onStdoutLine`.
 */
export interface LineBuffer {
  push(chunk: string): void;
  flush(): void;
}

export interface LineBufferOptions {
  onMarker: (marker: ParsedMarker) => void;
  onStdoutLine: (line: string) => void;
}

export function createLineBuffer(opts: LineBufferOptions): LineBuffer {
  let buffer = '';
  const consume = (line: string): void => {
    const marker = tryParseMarker(line);
    if (marker) {
      opts.onMarker(marker);
    } else {
      opts.onStdoutLine(line);
    }
  };
  return {
    push(chunk: string): void {
      buffer += chunk;
      let newlineIdx = buffer.indexOf('\n');
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        consume(line);
        newlineIdx = buffer.indexOf('\n');
      }
    },
    flush(): void {
      if (buffer.length > 0) {
        consume(buffer);
        buffer = '';
      }
    },
  };
}
