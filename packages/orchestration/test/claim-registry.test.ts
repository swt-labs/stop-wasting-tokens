/**
 * ClaimRegistry tests (M3 PR-23).
 *
 * Covers:
 *   - Disjoint claims: two tasks with different paths both register.
 *   - Overlap: second task's overlapping claim rejected with conflict.
 *   - Atomic registration: any conflict rejects the entire batch.
 *   - Self-overlap: same task re-registering its own claims is idempotent.
 *   - Case-insensitive FS safety: `Foo.ts` + `foo.ts` are the same claim.
 *   - Windows-style path normalization: `src\foo.ts` + `src/foo.ts` collide.
 *   - Slash normalization: `src//foo.ts` + `src/foo.ts` collide.
 *   - Leading `./` is stripped: `./foo.ts` + `foo.ts` collide.
 *   - release: drops all claims; subsequent registration works.
 *   - pathBelongsToClaim: predicate semantics for owner, non-owner, unknown.
 *   - getClaimsForTask: insertion order; original (non-normalized) paths.
 *   - Empty claims array: no-op success.
 *   - size + hasClaim helpers.
 */

import { describe, expect, it } from 'vitest';

import { ClaimRegistry, identifierFor } from '../src/claim-registry.js';

describe('ClaimRegistry — M3 PR-23', () => {
  describe('basic register / release', () => {
    it('accepts disjoint claims from two tasks', () => {
      const registry = new ClaimRegistry();
      expect(registry.register('T-001', ['src/a.ts', 'src/b.ts'])).toEqual({ ok: true });
      expect(registry.register('T-002', ['src/c.ts', 'src/d.ts'])).toEqual({ ok: true });
      expect(registry.size()).toBe(4);
    });

    it('rejects overlapping claim with conflict details', () => {
      const registry = new ClaimRegistry();
      expect(registry.register('T-001', ['src/foo.ts'])).toEqual({ ok: true });
      const result = registry.register('T-002', ['src/foo.ts']);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.conflicts).toEqual([{ path: 'src/foo.ts', otherTaskId: 'T-001' }]);
    });

    it('registration is atomic — any conflict aborts the whole batch', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts']);
      const result = registry.register('T-002', ['src/bar.ts', 'src/foo.ts', 'src/baz.ts']);
      expect(result.ok).toBe(false);
      // T-002 holds NO claims even though `src/bar.ts` and `src/baz.ts`
      // were individually conflict-free.
      expect(registry.getClaimsForTask('T-002')).toEqual([]);
      expect(registry.hasClaim('src/bar.ts')).toBe(false);
      expect(registry.hasClaim('src/baz.ts')).toBe(false);
      // T-001 still holds its claim.
      expect(registry.hasClaim('src/foo.ts')).toBe(true);
    });

    it('release drops all claims held by the task and allows re-registration', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts', 'src/bar.ts']);
      registry.release('T-001');
      expect(registry.size()).toBe(0);
      expect(registry.getClaimsForTask('T-001')).toEqual([]);

      // The same paths can now be claimed by a different task.
      expect(registry.register('T-002', ['src/foo.ts'])).toEqual({ ok: true });
    });

    it('release on an unknown taskId is a silent no-op', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts']);
      expect(() => registry.release('T-nonexistent')).not.toThrow();
      expect(registry.hasClaim('src/foo.ts')).toBe(true);
    });

    it('register with empty claims array is a no-op success', () => {
      const registry = new ClaimRegistry();
      expect(registry.register('T-001', [])).toEqual({ ok: true });
      expect(registry.size()).toBe(0);
      expect(registry.getClaimsForTask('T-001')).toEqual([]);
    });
  });

  describe('idempotent self-registration', () => {
    it('a task re-registering its own claims is a no-op success', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts']);
      expect(registry.register('T-001', ['src/foo.ts'])).toEqual({ ok: true });
      expect(registry.size()).toBe(1);
    });

    it('a task extending its claim set succeeds when no other task conflicts', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts']);
      expect(registry.register('T-001', ['src/foo.ts', 'src/bar.ts'])).toEqual({ ok: true });
      expect(registry.size()).toBe(2);
      expect(registry.getClaimsForTask('T-001')).toEqual(
        expect.arrayContaining(['src/foo.ts', 'src/bar.ts']),
      );
    });
  });

  describe('path normalization (case-insensitive FS + Windows safety)', () => {
    it('treats `Foo.ts` and `foo.ts` as the same claim', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/Foo.ts']);
      const result = registry.register('T-002', ['src/foo.ts']);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.conflicts[0]?.otherTaskId).toBe('T-001');
    });

    it('treats backslash-separated and slash-separated paths as the same', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src\\foo.ts']);
      const result = registry.register('T-002', ['src/foo.ts']);
      expect(result.ok).toBe(false);
    });

    it('collapses repeated slashes', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src//foo.ts']);
      expect(registry.hasClaim('src/foo.ts')).toBe(true);
    });

    it('strips leading `./`', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['./src/foo.ts']);
      expect(registry.hasClaim('src/foo.ts')).toBe(true);
      const result = registry.register('T-002', ['src/foo.ts']);
      expect(result.ok).toBe(false);
    });

    it('deduplicates same-batch case-variant claims (Foo.ts + foo.ts)', () => {
      const registry = new ClaimRegistry();
      // Caller listed two case variants for belt-and-braces; the
      // registry records one entry on case-insensitive FS.
      registry.register('T-001', ['src/Foo.ts', 'src/foo.ts']);
      expect(registry.size()).toBe(1);
    });

    it('the public identifierFor helper returns deterministic SHA-1 hex', () => {
      const a = identifierFor('src/Foo.ts');
      const b = identifierFor('src/foo.ts');
      const c = identifierFor('src\\foo.ts');
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(a).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe('pathBelongsToClaim predicate', () => {
    it('returns true for the owning task', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts']);
      expect(registry.pathBelongsToClaim('T-001', 'src/foo.ts')).toBe(true);
    });

    it('returns false for a non-owning task', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts']);
      expect(registry.pathBelongsToClaim('T-002', 'src/foo.ts')).toBe(false);
    });

    it('returns false for paths the task does not hold', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/foo.ts']);
      expect(registry.pathBelongsToClaim('T-001', 'src/bar.ts')).toBe(false);
    });

    it('honours case-insensitive matching', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/Foo.ts']);
      expect(registry.pathBelongsToClaim('T-001', 'src/FOO.TS')).toBe(true);
    });
  });

  describe('getClaimsForTask', () => {
    it('returns the original (non-normalized) paths the task supplied', () => {
      const registry = new ClaimRegistry();
      registry.register('T-001', ['src/Foo.ts', './README.md']);
      const claims = registry.getClaimsForTask('T-001');
      // Original forms preserved (not the lowercased identifier preimage).
      expect(claims).toEqual(expect.arrayContaining(['src/Foo.ts', './README.md']));
    });

    it('returns an empty array for an unknown task', () => {
      const registry = new ClaimRegistry();
      expect(registry.getClaimsForTask('T-nonexistent')).toEqual([]);
    });
  });

  describe('multi-task scenarios', () => {
    it('three tasks with one overlap each reports correct conflict origins', () => {
      const registry = new ClaimRegistry();
      registry.register('T-A', ['a.ts']);
      registry.register('T-B', ['b.ts']);
      const result = registry.register('T-C', ['a.ts', 'b.ts', 'c.ts']);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      // Both conflicts should be surfaced (atomic registration —
      // surfacing all conflicts lets the caller present the full
      // dependency graph instead of one-at-a-time discovery).
      expect(result.conflicts).toHaveLength(2);
      const owners = result.conflicts.map((c) => c.otherTaskId).sort();
      expect(owners).toEqual(['T-A', 'T-B']);
    });

    it('release of one task does not affect others', () => {
      const registry = new ClaimRegistry();
      registry.register('T-A', ['a.ts']);
      registry.register('T-B', ['b.ts']);
      registry.release('T-A');
      expect(registry.hasClaim('a.ts')).toBe(false);
      expect(registry.hasClaim('b.ts')).toBe(true);
      expect(registry.getClaimsForTask('T-B')).toEqual(['b.ts']);
    });
  });
});
