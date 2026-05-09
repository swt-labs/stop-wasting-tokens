import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { InitBodySchema, type InitResponse } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

const PLANNING_DIR = '.swt-planning';

function projectMd(name: string, description: string | undefined): string {
  const desc = description?.trim() ?? '';
  const descBlock = desc.length > 0 ? `\n\n${desc}\n` : '\n\n_(describe the project here)_\n';
  return `# ${name}${descBlock}\n## Requirements\n\n_(none yet — capture them via \`swt vibe\`)_\n\n## Constraints\n\n_(none yet)_\n`;
}

function stateMd(name: string): string {
  return `# State

**Project:** ${name}
**Milestone:** v0.1 — exploration

## Current Phase

_(none yet — run \`swt vibe\` to scope the first milestone)_

## Activity Log

- ${new Date().toISOString()}: Initialized via dashboard.
`;
}

export function registerInitRoute(
  app: Hono,
  cwd: string,
  onInitialized: (root: string) => void,
): void {
  app.post('/api/init', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = InitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const planningPath = path.join(cwd, PLANNING_DIR);
    if (existsSync(planningPath)) {
      return c.json(
        { error: 'already_initialized', detail: `${PLANNING_DIR}/ already exists at ${cwd}` },
        409,
      );
    }
    try {
      mkdirSync(planningPath, { recursive: true });
      mkdirSync(path.join(planningPath, 'phases'), { recursive: true });
      const projectPath = path.join(planningPath, 'PROJECT.md');
      const statePath = path.join(planningPath, 'STATE.md');
      writeFileSync(projectPath, projectMd(parsed.data.name, parsed.data.description), 'utf8');
      writeFileSync(statePath, stateMd(parsed.data.name), 'utf8');
      onInitialized(cwd);
      const response: InitResponse = {
        initialized: true,
        root: cwd,
        files: [
          path.relative(cwd, projectPath),
          path.relative(cwd, statePath),
          path.relative(cwd, path.join(planningPath, 'phases')),
        ],
      };
      return c.json(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'init_failed', detail: message }, 500);
    }
  });
}
