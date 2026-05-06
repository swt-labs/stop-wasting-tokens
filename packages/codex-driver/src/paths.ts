import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CodexPaths {
  /** ~/.codex or .codex/ depending on scope. */
  readonly root: string;
  readonly agentsDir: string;
  readonly skillsDir: string;
  readonly promptsDir: string;
  readonly configToml: string;
  readonly hooksJson: string;
}

export type Scope = 'user' | 'project';

export function resolveCodexPaths(scope: Scope, projectRoot?: string): CodexPaths {
  const root =
    scope === 'user'
      ? join(homedir(), '.codex')
      : join(projectRoot ?? process.cwd(), '.codex');
  return {
    root,
    agentsDir: join(root, 'agents'),
    skillsDir: join(root, 'skills'),
    promptsDir: join(root, 'prompts'),
    configToml: join(root, 'config.toml'),
    hooksJson: join(root, 'hooks.json'),
  };
}
