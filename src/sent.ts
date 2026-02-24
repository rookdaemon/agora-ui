import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getDefaultConfigPath } from '@rookdaemon/agora';

export const MAX_SENT_LINES = 500;

/**
 * Returns the path to the SENT.md file.
 * Uses storageDir if provided, otherwise falls back to the agora config directory.
 */
export function getSentPath(storageDir?: string): string {
  if (storageDir) {
    return join(storageDir, 'SENT.md');
  }
  const configPath = getDefaultConfigPath();
  return join(dirname(configPath), 'SENT.md');
}

/**
 * Appends a sent line to the SENT.md file.
 * Enforces a maximum of MAX_SENT_LINES lines.
 */
export function appendToSent(text: string, filePath?: string): void {
  const path = filePath ?? getSentPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let lines: string[] = [];
  if (existsSync(path)) {
    lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.length > 0);
  }

  const safeLine = text.replace(/\r?\n/g, ' ');
  lines.push(safeLine);

  if (lines.length > MAX_SENT_LINES) {
    lines = lines.slice(lines.length - MAX_SENT_LINES);
  }

  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Loads all sent lines from SENT.md.
 * Returns an empty array if the file does not exist.
 */
export function loadSent(filePath?: string): string[] {
  const path = filePath ?? getSentPath();

  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf-8');
  return content.split('\n').filter(l => l.length > 0);
}
