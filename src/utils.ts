import { formatDisplayName, sanitizeText, resolveDisplayName, shorten, expand, expandInlineReferences, compactInlineReferences, mergeDirectories } from '@rookdaemon/agora';
import type { AgoraPeerConfig, SeenKeyStore, PeerReferenceEntry } from '@rookdaemon/agora';

export { formatDisplayName, sanitizeText, resolveDisplayName };

/**
 * Look up a peer by name or public key in configPeers.
 * Returns the public key if found, undefined otherwise.
 */
function lookupPeerByNameOrKey(reference: string, configPeers: Record<string, AgoraPeerConfig>): string | undefined {
  // Direct lookup by key
  const byKey = configPeers[reference];
  if (byKey?.publicKey) {
    return byKey.publicKey;
  }

  // Search by name
  for (const peer of Object.values(configPeers)) {
    if (peer && typeof peer === 'object' && 'name' in peer && peer.name === reference) {
      return peer.publicKey;
    }
  }

  return undefined;
}

/**
 * Build a merged directory from config peers + seen keys.
 * Config peers take priority (they have names).
 */
function buildDirectory(configPeers: Record<string, AgoraPeerConfig>, seenKeyStore?: SeenKeyStore | null): PeerReferenceEntry[] {
  // Convert configPeers to PeerReferenceEntry[] format
  // configPeers values already have publicKey and name fields
  const entries = Object.values(configPeers).filter(
    (peer): peer is AgoraPeerConfig & { publicKey: string } =>
      peer && typeof peer === 'object' && 'publicKey' in peer && typeof (peer as any).publicKey === 'string'
  );
  return mergeDirectories(entries, seenKeyStore ? seenKeyStore.toReferenceEntries() : []);
}

export function extractTextFromPayload(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload && typeof (payload as { text: unknown }).text === 'string') {
    return sanitizeText((payload as { text: string }).text);
  }
  if (typeof payload === 'string') return sanitizeText(payload);
  return sanitizeText(JSON.stringify(payload ?? ''));
}

export function shortenPeerId(publicKey: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return shorten(publicKey, configPeers);
}

export function expandPeerRef(reference: string, configPeers: Record<string, AgoraPeerConfig>, seenKeyStore?: SeenKeyStore | null): string | undefined {
  // First try explicit lookup by name or key
  const explicit = lookupPeerByNameOrKey(reference, configPeers);
  if (explicit) {
    return explicit;
  }

  // Fall back to expand() for short forms (name@suffix, @suffix, etc.)
  return expand(reference, buildDirectory(configPeers, seenKeyStore));
}

export function expandInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>, seenKeyStore?: SeenKeyStore | null): string {
  return expandInlineReferences(text, seenKeyStore ? buildDirectory(configPeers, seenKeyStore) : configPeers);
}

export function compactInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return compactInlineReferences(text, configPeers);
}
