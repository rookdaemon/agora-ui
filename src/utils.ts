import * as Agora from '@rookdaemon/agora';
import { formatDisplayName, shorten, expand, expandInlineReferences, compactInlineReferences } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';

export { formatDisplayName };

const coreSanitizeText = (Agora as unknown as { sanitizeText?: (text: string) => string }).sanitizeText;
const coreResolveDisplayName = (Agora as unknown as {
  resolveDisplayName?: (
    publicKey: string,
    peerName: string | undefined,
    directory?: Record<string, AgoraPeerConfig>,
  ) => string | undefined;
}).resolveDisplayName;

function sanitizeTextFallback(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

function resolveDisplayNameFallback(
  publicKey: string,
  peerName: string | undefined,
  configPeers: Record<string, AgoraPeerConfig>,
): string | undefined {
  const configPeer = Object.values(configPeers).find((p) => p.publicKey === publicKey);
  if (configPeer?.name) {
    return configPeer.name;
  }
  if (peerName && !peerName.startsWith('...')) {
    return sanitizeText(peerName);
  }
  return undefined;
}

/**
 * Strip characters that crash Intl.Segmenter / string-width (used by Ink).
 * Removes lone surrogates and non-printable control chars (except newline/tab).
 */
export function sanitizeText(text: string): string {
  return coreSanitizeText ? coreSanitizeText(text) : sanitizeTextFallback(text);
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
  if (coreResolveDisplayName) {
    return coreResolveDisplayName(publicKey, peerName, configPeers);
  }
  return resolveDisplayNameFallback(publicKey, peerName, configPeers);
}

export function shortenPeerId(publicKey: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return shorten(publicKey, configPeers);
}

export function expandPeerRef(reference: string, configPeers: Record<string, AgoraPeerConfig>): string | undefined {
  return expand(reference, configPeers);
}

export function expandInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return expandInlineReferences(text, configPeers);
}

export function compactInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return compactInlineReferences(text, configPeers);
}
