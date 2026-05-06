import type {
  AgentSpawner,
  AgentSpec,
  HookContext,
  HookEvent,
  HookHandler,
  HookHost,
  HookOutcome,
  HookSubscription,
  MemoryEntry,
  MemoryQuery,
  MemoryStore,
  PermissionDecision,
  PermissionGate,
  PermissionProfile,
  PermissionRequest,
  SpawnRequest,
  SpawnResult,
} from '../src/abstractions/index.js';
import type { AgentRole } from '../src/types/agent-role.js';

export class MockHookHost implements HookHost {
  private readonly handlers = new Map<HookEvent, Set<HookHandler>>();

  on(event: HookEvent, handler: HookHandler): HookSubscription {
    let bucket = this.handlers.get(event);
    if (bucket === undefined) {
      bucket = new Set();
      this.handlers.set(event, bucket);
    }
    bucket.add(handler);
    return {
      unsubscribe: (): void => {
        bucket?.delete(handler);
      },
    };
  }

  async dispatch(context: HookContext): Promise<HookOutcome> {
    const bucket = this.handlers.get(context.event);
    if (bucket === undefined || bucket.size === 0) return { decision: 'allow' };
    for (const handler of bucket) {
      const outcome = await handler(context);
      if (outcome.decision === 'block') return outcome;
    }
    return { decision: 'allow' };
  }

  async flush(): Promise<void> {
    /* no-op for in-memory mock */
  }
}

export class MockAgentSpawner implements AgentSpawner {
  public readonly installed = new Map<AgentRole, AgentSpec>();
  public readonly spawned: SpawnRequest[] = [];

  async installAgent(spec: AgentSpec): Promise<void> {
    this.installed.set(spec.role, spec);
  }

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    this.spawned.push(request);
    return {
      role: request.spec.role,
      success: true,
      text: `[mock ${request.spec.role}] OK`,
    };
  }

  async removeAgent(role: AgentRole): Promise<void> {
    this.installed.delete(role);
  }
}

export class MockPermissionGate implements PermissionGate {
  private readonly profiles = new Map<string, PermissionProfile>();

  async registerProfile(profile: PermissionProfile): Promise<void> {
    this.profiles.set(profile.name, profile);
  }

  async removeProfile(name: string): Promise<void> {
    this.profiles.delete(name);
  }

  async evaluate(request: PermissionRequest): Promise<PermissionDecision> {
    const profile = this.profiles.get(request.profile);
    if (profile === undefined) {
      return { allow: false, reason: `unknown profile ${request.profile}` };
    }
    if (profile.sandbox_mode === 'read-only' && request.tool !== 'Read') {
      return { allow: false, reason: 'profile is read-only' };
    }
    return { allow: true };
  }
}

export class MockMemoryStore implements MemoryStore {
  private readonly entries = new Map<string, MemoryEntry>();

  async put(entry: MemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.entries.get(id);
  }

  async query(filter: MemoryQuery): Promise<readonly MemoryEntry[]> {
    let results = Array.from(this.entries.values());
    if (filter.topic !== undefined) {
      const topic = filter.topic;
      results = results.filter((e) => e.topic === topic);
    }
    if (filter.tag !== undefined) {
      const tag = filter.tag;
      results = results.filter((e) => e.tags?.includes(tag) === true);
    }
    if (filter.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }
    return results;
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async compact(): Promise<void> {
    /* no-op for in-memory mock */
  }
}
