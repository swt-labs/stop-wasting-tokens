import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateCliMdx, generateConfigMdx, generateArtifactsMdx } from '../../scripts/docs-gen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REFERENCE_DIR = join(__dirname, '..', '..', 'docs', 'reference');

interface DriftCase {
  readonly file: string;
  readonly generator: () => string;
}

const cases: readonly DriftCase[] = [
  { file: 'cli.mdx', generator: generateCliMdx },
  { file: 'config.mdx', generator: generateConfigMdx },
  { file: 'artifacts.mdx', generator: generateArtifactsMdx },
];

describe('docs drift', () => {
  for (const { file, generator } of cases) {
    it(`${file} matches scripts/docs-gen.ts output`, () => {
      const expected = generator();
      const actual = readFileSync(join(REFERENCE_DIR, file), 'utf8');
      if (actual !== expected) {
        throw new Error(
          `docs/reference/${file} is out of sync with scripts/docs-gen.ts. ` +
            `Run 'pnpm docs:gen' to regenerate.`,
        );
      }
      expect(actual).toBe(expected);
    });
  }
});
