import { join } from 'node:path';

import { writeAtomically } from '../atomic-write.js';

export interface WriteProjectOptions {
  readonly planningDir: string;
  readonly name: string;
  readonly description: string;
  readonly core_value?: string;
}

export async function writeProject(opts: WriteProjectOptions): Promise<string> {
  const path = join(opts.planningDir, 'PROJECT.md');
  const coreValue = opts.core_value ?? opts.description;
  const body = [
    `# ${opts.name}`,
    '',
    opts.description,
    '',
    `**Core value:** ${coreValue}`,
    '',
    '## Requirements',
    '',
    '### Validated',
    '_(none yet — see REQUIREMENTS.md for v1 scope)_',
    '',
    '### Active',
    '_(none yet)_',
    '',
    '### Out of Scope',
    '_(none yet)_',
    '',
    '## Constraints',
    '_(none yet)_',
    '',
    '## Key Decisions',
    '',
    '| Decision | Rationale | Outcome |',
    '|----------|-----------|---------|',
    '| _(none yet)_ |  |  |',
    '',
  ].join('\n');
  await writeAtomically(path, body);
  return path;
}
