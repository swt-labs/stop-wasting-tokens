import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_CONFIG, parseConfig, type SwtConfig } from '@swt-labs/core';

/**
 * Load the SWT config from a planning directory's `config.json`. Returns
 * `DEFAULT_CONFIG` if the file is missing, unreadable, or malformed JSON.
 * Validation errors from `parseConfig` propagate so callers can surface them.
 */
export async function loadSwtConfig(planningDir: string): Promise<SwtConfig> {
  const path = join(planningDir, 'config.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return DEFAULT_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
  return parseConfig(parsed);
}
