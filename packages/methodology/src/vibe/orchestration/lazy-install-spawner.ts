import type { AgentRole, AgentSpec, AgentSpawner, SpawnRequest, SpawnResult } from '@swt-labs/core';

export type AgentSpecResolverFn = (role: AgentRole) => Promise<AgentSpec>;

/**
 * Wraps a base AgentSpawner so that `installAgent` runs lazily on the first
 * `spawn(request)` call for each role. Subsequent spawns reuse the install.
 *
 * `cleanup()` calls `removeAgent(role)` on the base for every role that was
 * installed via this wrapper, so callers can drop a single line into a
 * `finally` block at end of session.
 */
export class LazyInstallSpawner implements AgentSpawner {
  private readonly base: AgentSpawner;
  private readonly resolveSpec: AgentSpecResolverFn;
  private readonly installed: Set<AgentRole> = new Set();
  private readonly inflight: Map<AgentRole, Promise<void>> = new Map();

  constructor(base: AgentSpawner, resolveSpec: AgentSpecResolverFn) {
    this.base = base;
    this.resolveSpec = resolveSpec;
  }

  async installAgent(spec: AgentSpec): Promise<void> {
    await this.base.installAgent(spec);
    this.installed.add(spec.role);
  }

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    await this.ensureInstalled(request.spec.role);
    return this.base.spawn(request);
  }

  async removeAgent(role: AgentRole): Promise<void> {
    try {
      await this.base.removeAgent(role);
    } finally {
      this.installed.delete(role);
      this.inflight.delete(role);
    }
  }

  /**
   * Tear down every role installed via this wrapper. Failures from individual
   * `removeAgent` calls are swallowed so cleanup never throws — partial
   * teardown is preferable to leaking an exception out of `finally`. The
   * installed set is always cleared so a second `cleanup()` is a no-op.
   */
  async cleanup(): Promise<void> {
    const roles = Array.from(this.installed);
    await Promise.allSettled(roles.map((role) => this.removeAgent(role)));
  }

  /** Test seam: report which roles have been installed so far. */
  installedRoles(): readonly AgentRole[] {
    return Array.from(this.installed);
  }

  private async ensureInstalled(role: AgentRole): Promise<void> {
    if (this.installed.has(role)) return;
    let pending = this.inflight.get(role);
    if (pending === undefined) {
      pending = this.installRole(role);
      this.inflight.set(role, pending);
    }
    await pending;
  }

  private async installRole(role: AgentRole): Promise<void> {
    try {
      const spec = await this.resolveSpec(role);
      await this.base.installAgent(spec);
      this.installed.add(role);
    } finally {
      this.inflight.delete(role);
    }
  }
}
