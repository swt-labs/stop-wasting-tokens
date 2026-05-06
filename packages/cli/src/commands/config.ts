import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ConfigError, DEFAULT_CONFIG, parseConfig, type SwtConfig } from '@swt-labs/core';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

const CONFIG_PATH_RELATIVE = '.swt-planning/config.json';

async function loadConfig(cwd: string): Promise<SwtConfig> {
  const path = join(cwd, CONFIG_PATH_RELATIVE);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(`Failed to parse ${CONFIG_PATH_RELATIVE} as JSON`, { cause });
  }
  return parseConfig(parsed);
}

async function saveConfig(cwd: string, config: SwtConfig): Promise<void> {
  const path = join(cwd, CONFIG_PATH_RELATIVE);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export const configHandler: CommandHandler = async (parsed, io: CommandIO) => {
  const sub = parsed.positionals[0];
  if (sub === undefined || sub === 'show') {
    return showConfig(io);
  }
  if (sub === 'get') {
    const key = parsed.positionals[1];
    if (key === undefined) {
      io.stderr.write('Usage: swt config get <key>\n');
      return EXIT.USAGE_ERROR;
    }
    return getConfigKey(io, key);
  }
  if (sub === 'set') {
    const key = parsed.positionals[1];
    const value = parsed.positionals[2];
    if (key === undefined || value === undefined) {
      io.stderr.write('Usage: swt config set <key> <value>\n');
      return EXIT.USAGE_ERROR;
    }
    return setConfigKey(io, key, value);
  }
  io.stderr.write(`Unknown config subcommand: ${sub}\n`);
  io.stderr.write('Usage: swt config [show|get <key>|set <key> <value>]\n');
  return EXIT.USAGE_ERROR;

  async function showConfig(out: CommandIO): Promise<ExitCode> {
    const config = await loadConfig(out.cwd);
    out.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return EXIT.SUCCESS;
  }

  async function getConfigKey(out: CommandIO, key: string): Promise<ExitCode> {
    const config = await loadConfig(out.cwd);
    const value = (config as unknown as Record<string, unknown>)[key];
    if (value === undefined) {
      out.stderr.write(`Unknown key: ${key}\n`);
      return EXIT.USAGE_ERROR;
    }
    out.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
    return EXIT.SUCCESS;
  }

  async function setConfigKey(
    out: CommandIO,
    key: string,
    rawValue: string,
  ): Promise<ExitCode> {
    const config = await loadConfig(out.cwd);
    const next = { ...config, [key]: coerceValue(rawValue) } as Record<string, unknown>;
    let validated: SwtConfig;
    try {
      validated = parseConfig(next);
    } catch (err) {
      out.stderr.write(
        err instanceof ConfigError
          ? `Invalid value for ${key}: ${err.message}\n`
          : `Failed to validate config: ${String(err)}\n`,
      );
      return EXIT.USAGE_ERROR;
    }
    await saveConfig(out.cwd, validated);
    out.stdout.write(`Set ${key} = ${rawValue}\n`);
    return EXIT.SUCCESS;
  }
};

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
