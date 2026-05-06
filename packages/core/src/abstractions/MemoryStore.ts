export interface MemoryEntry {
  readonly id: string;
  readonly topic: string;
  readonly content: string;
  /** Optional ISO timestamp. */
  readonly created_at?: string;
  /** Optional structured tags for retrieval. */
  readonly tags?: readonly string[];
}

export interface MemoryQuery {
  readonly topic?: string;
  readonly tag?: string;
  readonly limit?: number;
}

/**
 * Manages SWT's MEMORY.md self-healing memory model:
 *  - a lightweight always-on index (≤ 200 lines)
 *  - topic files referenced by the index
 *  - structured handoff envelopes
 *  - backend session continuity (e.g. `codex resume` rollouts)
 */
export interface MemoryStore {
  /** Upsert an entry. Idempotent on `id`. */
  put(entry: MemoryEntry): Promise<void>;
  get(id: string): Promise<MemoryEntry | undefined>;
  query(filter: MemoryQuery): Promise<readonly MemoryEntry[]>;
  remove(id: string): Promise<void>;
  /** Trigger a self-healing pass (rebuild index, prune stale topics). */
  compact(): Promise<void>;
}
