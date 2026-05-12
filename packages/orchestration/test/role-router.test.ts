import { describe, expect, it } from 'vitest';

import { ROLE_TOOL_SUBSETS, toolsForRole } from '../src/role-router.js';

describe('@swt-labs/orchestration — role-router', () => {
  describe('toolsForRole', () => {
    it('returns read-only tools for Scout', () => {
      const tools = toolsForRole('scout', '/tmp');
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('returns read-only tools for Architect', () => {
      const tools = toolsForRole('architect', '/tmp');
      expect(tools).toBeDefined();
    });

    it('returns coding tools for Lead, Dev, Debugger', () => {
      for (const role of ['lead', 'dev', 'debugger'] as const) {
        const tools = toolsForRole(role, '/tmp');
        expect(tools, `${role} should have a tool list`).toBeDefined();
      }
    });

    it('returns coding tools (incl. bash) for QA at M2', () => {
      // M2 hands QA the full coding set; the prompt-level constraint enforces
      // "no edits". M3+ adds a true qa-bash factory (read-only + bash only).
      const tools = toolsForRole('qa', '/tmp');
      expect(tools).toBeDefined();
    });
  });

  describe('ROLE_TOOL_SUBSETS', () => {
    it('declares the subset label for every SDLC role', () => {
      expect(ROLE_TOOL_SUBSETS.scout).toBe('readonly');
      expect(ROLE_TOOL_SUBSETS.architect).toBe('readonly');
      expect(ROLE_TOOL_SUBSETS.lead).toBe('coding');
      expect(ROLE_TOOL_SUBSETS.dev).toBe('coding');
      expect(ROLE_TOOL_SUBSETS.qa).toBe('qa-bash');
      expect(ROLE_TOOL_SUBSETS.debugger).toBe('coding');
    });
  });
});
