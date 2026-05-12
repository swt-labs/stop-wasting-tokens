import { randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentPromptContext, AgentPromptOption, SnapshotEvent } from '@swt-labs/shared';

import type { EventBus } from '../event-bus.js';

export type SessionState =
  | 'idle'
  | 'running'
  | 'awaiting-reply'
  | 'completed'
  | 'failed'
  | 'expired';

export type PromptSubtype = 'clarification' | 'permission';

export interface PendingPrompt {
  prompt_id: string;
  subtype: PromptSubtype;
  question: string;
  options?: AgentPromptOption[];
  context?: AgentPromptContext;
  emitted_at: string;
  expires_at: string;
}

export type ReplyKind =
  | { kind: 'choice'; value: string }
  | { kind: 'free_form'; text: string }
  | { kind: 'permission'; decision: 'once' | 'session' | 'deny'; user_note?: string }
  | { kind: 'expired' };

export interface VibeSession {
  readonly id: string;
  readonly created_at: string;
  readonly project_root: string;
  readonly initial_prompt: string;
  state: SessionState;
  pending_prompt: PendingPrompt | null;
  /**
   * In-memory permission allowlist for "Approve for session" replies. Keyed
   * by `${operation}::${target_pattern}`. Memory-only — does not persist
   * across daemon restarts (per v2-permission-model.md decision).
   */
  permission_allowlist: Set<string>;
}

export interface CreateSessionOptions {
  project_root: string;
  initial_prompt: string;
  /** Override the default 1h clarification expiry (ms). */
  clarification_timeout_ms?: number;
  /** Override the default 5m permission expiry (ms). */
  permission_timeout_ms?: number;
  /** Override session id generator (tests). */
  id?: string;
}

export interface EmitPromptOptions {
  subtype: PromptSubtype;
  question: string;
  options?: AgentPromptOption[];
  context?: AgentPromptContext;
}

export interface ReplyResult {
  ok: boolean;
  error?:
    | 'session_not_found'
    | 'session_not_blocking'
    | 'prompt_id_mismatch'
    | 'prompt_expired'
    | 'invalid_answer_kind';
  expected_prompt_id?: string;
}

const DEFAULT_CLARIFICATION_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;
const SESSIONS_DIR_NAME = '.vibe-sessions';

export interface SessionRegistry {
  create(opts: CreateSessionOptions): VibeSession;
  get(id: string): VibeSession | null;
  list(): VibeSession[];
  emitPrompt(session_id: string, opts: EmitPromptOptions): PendingPrompt | null;
  reply(session_id: string, prompt_id: string, reply: ReplyKind): ReplyResult;
  /**
   * Resolve the pending reply Promise for a session. Returns the reply when
   * the session's pending prompt is answered. Returns `{kind: 'expired'}` on
   * timeout. Throws if the session has no pending prompt.
   */
  awaitReply(session_id: string): Promise<ReplyKind>;
  setState(id: string, state: SessionState): void;
  shutdown(): void;
}

interface InternalSession extends VibeSession {
  /** Resolves when the pending prompt is answered (or expires). */
  pending_resolver: ((reply: ReplyKind) => void) | null;
  expiry_timer: ReturnType<typeof setTimeout> | null;
  clarification_timeout_ms: number;
  permission_timeout_ms: number;
}

function eventsLogPath(planning_path: string, session_id: string): string {
  return join(planning_path, SESSIONS_DIR_NAME, session_id, 'events.jsonl');
}

function appendEventToLog(planning_path: string, session_id: string, event: unknown): void {
  const path = eventsLogPath(planning_path, session_id);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
}

function publishEvent(bus: EventBus, event: SnapshotEvent): void {
  bus.publish(event);
}

export interface CreateRegistryOptions {
  bus: EventBus;
  /** Path to the project's `.swt-planning/` directory (where session JSONL lives). */
  planning_path: string;
}

export function createSessionRegistry(opts: CreateRegistryOptions): SessionRegistry {
  const { bus, planning_path } = opts;
  const sessions = new Map<string, InternalSession>();

  const create = (createOpts: CreateSessionOptions): VibeSession => {
    const id = createOpts.id ?? randomUUID();
    if (sessions.has(id)) {
      throw new Error(`session ${id} already exists`);
    }
    const session: InternalSession = {
      id,
      created_at: new Date().toISOString(),
      project_root: createOpts.project_root,
      initial_prompt: createOpts.initial_prompt,
      state: 'idle',
      pending_prompt: null,
      permission_allowlist: new Set(),
      pending_resolver: null,
      expiry_timer: null,
      clarification_timeout_ms:
        createOpts.clarification_timeout_ms ?? DEFAULT_CLARIFICATION_TIMEOUT_MS,
      permission_timeout_ms: createOpts.permission_timeout_ms ?? DEFAULT_PERMISSION_TIMEOUT_MS,
    };
    sessions.set(id, session);
    appendEventToLog(planning_path, id, {
      type: 'session.created',
      ts: session.created_at,
      session_id: id,
      project_root: session.project_root,
      initial_prompt: session.initial_prompt,
    });
    return session;
  };

  const emitPrompt = (session_id: string, promptOpts: EmitPromptOptions): PendingPrompt | null => {
    const session = sessions.get(session_id);
    if (!session) return null;
    if (session.pending_prompt) {
      // FIFO: caller must reply to the existing prompt before emitting another.
      // Phase 2 ships strict-fail; later phases may queue.
      return null;
    }

    const prompt_id = randomUUID();
    const now = new Date();
    const timeout_ms =
      promptOpts.subtype === 'permission'
        ? session.permission_timeout_ms
        : session.clarification_timeout_ms;
    const expires_at = new Date(now.getTime() + timeout_ms).toISOString();

    const prompt: PendingPrompt = {
      prompt_id,
      subtype: promptOpts.subtype,
      question: promptOpts.question,
      ...(promptOpts.options !== undefined ? { options: promptOpts.options } : {}),
      ...(promptOpts.context !== undefined ? { context: promptOpts.context } : {}),
      emitted_at: now.toISOString(),
      expires_at,
    };

    session.pending_prompt = prompt;
    session.state = 'awaiting-reply';

    const event: SnapshotEvent = {
      type: 'agent.prompt',
      ts: prompt.emitted_at,
      session_id,
      prompt_id,
      subtype: prompt.subtype,
      question: prompt.question,
      ...(prompt.options !== undefined ? { options: prompt.options } : {}),
      ...(prompt.context !== undefined ? { context: prompt.context } : {}),
      expires_at,
    };
    publishEvent(bus, event);
    appendEventToLog(planning_path, session_id, event);

    session.expiry_timer = setTimeout(() => {
      // Only fire if the prompt is still pending — a reply that arrived in
      // the same tick will have cleared pending_prompt already.
      if (session.pending_prompt?.prompt_id !== prompt_id) return;
      const expired_at = new Date().toISOString();
      const timeoutEvent: SnapshotEvent = {
        type: 'agent.prompt.timeout',
        ts: expired_at,
        session_id,
        prompt_id,
        expired_at,
      };
      publishEvent(bus, timeoutEvent);
      appendEventToLog(planning_path, session_id, timeoutEvent);
      session.pending_prompt = null;
      session.state = 'running';
      const resolver = session.pending_resolver;
      session.pending_resolver = null;
      if (resolver) resolver({ kind: 'expired' });
    }, timeout_ms);

    return prompt;
  };

  const reply = (session_id: string, prompt_id: string, replyValue: ReplyKind): ReplyResult => {
    const session = sessions.get(session_id);
    if (!session) return { ok: false, error: 'session_not_found' };
    if (session.state !== 'awaiting-reply' || !session.pending_prompt) {
      return { ok: false, error: 'session_not_blocking' };
    }
    if (session.pending_prompt.prompt_id !== prompt_id) {
      return {
        ok: false,
        error: 'prompt_id_mismatch',
        expected_prompt_id: session.pending_prompt.prompt_id,
      };
    }
    const now = new Date();
    if (new Date(session.pending_prompt.expires_at).getTime() <= now.getTime()) {
      return { ok: false, error: 'prompt_expired' };
    }
    if (!isReplyKindValid(replyValue, session.pending_prompt)) {
      return { ok: false, error: 'invalid_answer_kind' };
    }
    appendEventToLog(planning_path, session_id, {
      type: 'session.reply',
      ts: now.toISOString(),
      session_id,
      prompt_id,
      reply: replyValue,
    });

    if (replyValue.kind === 'permission' && replyValue.decision === 'session') {
      const allowKey = sessionAllowKey(session.pending_prompt);
      if (allowKey) session.permission_allowlist.add(allowKey);
    }

    if (session.expiry_timer) {
      clearTimeout(session.expiry_timer);
      session.expiry_timer = null;
    }
    session.pending_prompt = null;
    session.state = 'running';
    const resolver = session.pending_resolver;
    session.pending_resolver = null;
    if (resolver) resolver(replyValue);
    return { ok: true };
  };

  const awaitReply = (session_id: string): Promise<ReplyKind> => {
    const session = sessions.get(session_id);
    if (!session) return Promise.reject(new Error(`session ${session_id} not found`));
    if (!session.pending_prompt) {
      return Promise.reject(new Error(`session ${session_id} has no pending prompt`));
    }
    if (session.pending_resolver) {
      return Promise.reject(new Error(`session ${session_id} already has a pending awaiter`));
    }
    return new Promise<ReplyKind>((resolve) => {
      session.pending_resolver = resolve;
    });
  };

  const setState = (id: string, state: SessionState): void => {
    const session = sessions.get(id);
    if (!session) return;
    session.state = state;
    appendEventToLog(planning_path, id, {
      type: 'session.state',
      ts: new Date().toISOString(),
      session_id: id,
      state,
    });
  };

  const shutdown = (): void => {
    for (const session of sessions.values()) {
      if (session.expiry_timer) clearTimeout(session.expiry_timer);
      session.expiry_timer = null;
      session.pending_resolver = null;
    }
  };

  return {
    create,
    get: (id) => sessions.get(id) ?? null,
    list: () => Array.from(sessions.values()),
    emitPrompt,
    reply,
    awaitReply,
    setState,
    shutdown,
  };
}

function isReplyKindValid(reply: ReplyKind, prompt: PendingPrompt): boolean {
  if (prompt.subtype === 'permission') {
    return reply.kind === 'permission';
  }
  if (prompt.options && prompt.options.length > 0) {
    return reply.kind === 'choice' && prompt.options.some((opt) => opt.value === reply.value);
  }
  return reply.kind === 'free_form';
}

function sessionAllowKey(prompt: PendingPrompt): string | null {
  const op = prompt.context?.operation;
  const target = prompt.context?.target;
  if (!op || !target) return null;
  return `${op}::${target}`;
}

/**
 * Read past events from the disk-backed log for a session. Used to
 * reconstruct session history after a daemon restart. Returns an empty array
 * if the log doesn't exist.
 */
export function readSessionEventsLog(planning_path: string, session_id: string): unknown[] {
  const path = eventsLogPath(planning_path, session_id);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const out: unknown[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // Skip corrupt lines; the JSONL is append-only and a partial write is
      // recoverable as "everything before this line is good".
      break;
    }
  }
  return out;
}

/**
 * List all session ids with disk-backed event logs under the planning path.
 * Used at daemon startup to list known sessions for resumption.
 */
export function listPersistedSessionIds(planning_path: string): string[] {
  const dir = join(planning_path, SESSIONS_DIR_NAME);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
