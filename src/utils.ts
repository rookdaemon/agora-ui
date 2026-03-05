import { shortKey } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';

/**
 * Strip characters that crash Intl.Segmenter / string-width (used by Ink).
 * Removes lone surrogates and non-printable control chars (except newline/tab).
 */
export function sanitizeText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
             .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
             .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

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
  // Only use if it's not a short ID (short IDs start with "...")
  if (peerName && !peerName.startsWith('...')) {
    return sanitizeText(peerName);
  }

  // Priority 3: No name available
  return undefined;
}

/**
 * Formats a display name with short ID postfix.
 * If name exists: "name (...3f8c2247)"
 * If no name: "...3f8c2247" (short ID only)
 *
 * @param name - Optional name to display (should not be a short ID)
 * @param publicKey - The public key to use for short ID
 * @returns Formatted display string
 */
export function formatDisplayName(name: string | undefined, publicKey: string): string {
  const shortId = shortKey(publicKey);
  // If name is undefined, empty, or is already a short ID, return only short ID
  if (!name || name.trim() === '' || name.startsWith('...')) {
    return shortId;
  }
  return `${name} (${shortId})`;
}

export function shortenPeerId(publicKey: string, configPeers: Record<string, AgoraPeerConfig>): string {
  const peer = Object.values(configPeers).find((p) => p.publicKey === publicKey);
  if (!peer?.name) {
    return shortKey(publicKey);
  }
  const duplicates = Object.values(configPeers).filter((p) => p.name === peer.name).length;
  if (duplicates > 1) {
    return `${peer.name}...${publicKey.slice(-8)}`;
  }
  return peer.name;
}

export function expandPeerRef(reference: string, configPeers: Record<string, AgoraPeerConfig>): string | undefined {
  const ref = reference.trim();
  const direct = Object.values(configPeers).find((p) => p.publicKey === ref);
  if (direct) {
    return direct.publicKey;
  }

  const withSuffix = ref.match(/^(.+)\.\.\.([0-9a-fA-F]{8})$/);
  if (withSuffix) {
    const [, name, suffix] = withSuffix;
    const matches = Object.values(configPeers).filter(
      (p) => p.name === name && p.publicKey.toLowerCase().endsWith(suffix.toLowerCase())
    );
    return matches.length === 1 ? matches[0].publicKey : undefined;
  }

  if (ref.startsWith('...') && ref.length === 11) {
    const suffix = ref.slice(3).toLowerCase();
    const matches = Object.values(configPeers).filter((p) => p.publicKey.toLowerCase().endsWith(suffix));
    return matches.length === 1 ? matches[0].publicKey : undefined;
  }

  const byName = Object.values(configPeers).filter((p) => p.name === ref);
  return byName.length === 1 ? byName[0].publicKey : undefined;
}

export function expandInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return text.replace(/@([^\s]+)/g, (_m, token: string) => {
    const expanded = expandPeerRef(token, configPeers);
    return expanded ? `@${expanded}` : `@${token}`;
  });
}

export function compactInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return text.replace(/@([0-9a-fA-F]{16,})/g, (_m, id: string) => `@${shortenPeerId(id, configPeers)}`);
}
