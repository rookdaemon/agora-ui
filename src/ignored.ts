import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getDefaultConfigPath } from '@rookdaemon/agora';

export const IGNORED_FILE_NAME = 'IGNORED_PEERS.md';

export function getIgnoredPath(storageDir?: string): string {
  if (storageDir) {
    return join(storageDir, IGNORED_FILE_NAME);
  }
  const configPath = getDefaultConfigPath();
  return join(dirname(configPath), IGNORED_FILE_NAME);
}

export function loadIgnoredPeers(filePath?: string): string[] {
  const path = filePath ?? getIgnoredPath();
  if (!existsSync(path)) return [];

  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return Array.from(new Set(lines));
}

export function saveIgnoredPeers(peers: string[], filePath?: string): void {
  const path = filePath ?? getIgnoredPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const unique = Array.from(new Set(peers.map((peer) => peer.trim()).filter(Boolean))).sort();
  const content = [
    '# Ignored peers',
    '# One public key per line',
    ...unique,
    '',
  ].join('\n');

  writeFileSync(path, content, 'utf-8');
}
