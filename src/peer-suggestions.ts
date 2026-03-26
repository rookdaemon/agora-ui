import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { AgoraPeerConfig } from '@rookdaemon/agora';

/**
 * Returns recipient public keys that are not present in configPeers (excluding self).
 */
export function findUnknownPeers(
  recipients: string[],
  configPeers: Record<string, AgoraPeerConfig>,
  selfKey: string,
): string[] {
  const knownKeys = new Set(Object.keys(configPeers));
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const key of recipients) {
    if (key === selfKey || knownKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    unknown.push(key);
  }
  return unknown;
}

/**
 * Adds a peer to the agora config.json file on disk.
 * Returns { ok: true } on success or { ok: false, error } on failure.
 */
export function addPeerToConfig(
  configPath: string,
  publicKey: string,
  name: string | undefined,
): { ok: boolean; error?: string } {
  try {
    if (!existsSync(configPath)) {
      return { ok: false, error: `Config file not found: ${configPath}` };
    }
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;

    if (!config.peers || typeof config.peers !== 'object') {
      config.peers = {};
    }
    const peers = config.peers as Record<string, { publicKey: string; name?: string }>;

    // Determine the key to use in the peers object
    const peerLabel = name ?? publicKey.slice(-8);

    // Don't overwrite an existing entry with the same label
    if (peers[peerLabel]) {
      // Use a disambiguated key instead
      const altLabel = (name ? name + '_' : '') + publicKey.slice(-8);
      if (!peers[altLabel]) {
        const entry: { publicKey: string; name?: string } = { publicKey };
        if (name) entry.name = name;
        peers[altLabel] = entry;
      }
    } else {
      const entry: { publicKey: string; name?: string } = { publicKey };
      if (name) entry.name = name;
      peers[peerLabel] = entry;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
