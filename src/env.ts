import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface AgoraUiEnv {
  /** Path to the storage folder where CONVERSATION.md is kept (e.g. ~/.agora-ui/) */
  storageDir?: string;
  /** WebSocket relay URL */
  relayUrl?: string;
  /** Path to agora config file */
  configPath?: string;
  /** Display name broadcast to peers */
  name?: string;
}

/**
 * Parses a .env file content into a key/value record.
 * - Ignores blank lines and lines starting with #
 * - Supports optional surrounding quotes (single or double) on values
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Expands a leading ~/ in a path to the user's home directory.
 */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Loads .env from the given path (or falls back to process.cwd()/.env).
 * Returns AgoraUiEnv with values from the file; unknown keys are ignored.
 * Actual process.env values are NOT modified.
 */
export function loadEnv(envFilePath?: string): AgoraUiEnv {
  const path = envFilePath ?? join(process.cwd(), '.env');
  if (!existsSync(path)) return {};

  const content = readFileSync(path, 'utf-8');
  const raw = parseEnvContent(content);

  const env: AgoraUiEnv = {};

  if (raw['AGORA_UI_STORAGE_DIR']) {
    env.storageDir = expandHome(raw['AGORA_UI_STORAGE_DIR']);
  }
  if (raw['AGORA_UI_RELAY_URL']) {
    env.relayUrl = raw['AGORA_UI_RELAY_URL'];
  }
  if (raw['AGORA_UI_CONFIG']) {
    env.configPath = expandHome(raw['AGORA_UI_CONFIG']);
  }
  if (raw['AGORA_UI_NAME']) {
    env.name = raw['AGORA_UI_NAME'];
  }

  return env;
}
