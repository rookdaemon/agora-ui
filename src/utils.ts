import { shortKey } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';

/**
 * Resolves the display name for a peer in the UI.
 * Priority order:
 * 1. config.peers[publicKey].name (local config override)
 * 2. peer.name (broadcast name from relay)
 * 3. undefined (no name available, will show only short ID)
 *
 * @param publicKey - The peer's public key
 * @param peerName - Optional name broadcast by the peer via relay
 * @param configPeers - The peers configuration object from config
 * @returns The resolved display name, or undefined if none available
 */
export function resolveDisplayName(
  publicKey: string,
  peerName: string | undefined,
  configPeers: Record<string, AgoraPeerConfig>
): string | undefined {
  // Priority 1: config.peers[publicKey].name (local config override)
  // Find peer by publicKey in config
  const configPeer = Object.values(configPeers).find(p => p.publicKey === publicKey);
  if (configPeer?.name) {
    return configPeer.name;
  }

  // Priority 2: peer.name (broadcast name from relay)
  if (peerName) {
    return peerName;
  }

  // Priority 3: No name available
  return undefined;
}

/**
 * Formats a display name with short ID postfix.
 * If name exists: "name (...3f8c2247)"
 * If no name: "...3f8c2247" (short ID only)
 *
 * @param name - Optional name to display
 * @param publicKey - The public key to use for short ID
 * @returns Formatted display string
 */
export function formatDisplayName(name: string | undefined, publicKey: string): string {
  const shortId = shortKey(publicKey);
  if (name) {
    return `${name} (${shortId})`;
  }
  return shortId;
}
