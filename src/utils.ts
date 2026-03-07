import { formatDisplayName, sanitizeText, resolveDisplayName, shorten, expand, expandInlineReferences, compactInlineReferences, mergeDirectories } from '@rookdaemon/agora';
import type { AgoraPeerConfig, SeenKeyStore, PeerReferenceEntry } from '@rookdaemon/agora';

export { formatDisplayName, sanitizeText, resolveDisplayName };

/**
 * Build a merged directory from config peers + seen keys.
 * Config peers take priority (they have names).
 */
function buildDirectory(configPeers: Record<string, AgoraPeerConfig>, seenKeyStore?: SeenKeyStore | null): PeerReferenceEntry[] {
  return mergeDirectories(configPeers, seenKeyStore ? seenKeyStore.toReferenceEntries() : []);
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
  return expand(reference, buildDirectory(configPeers, seenKeyStore));
}

export function expandInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>, seenKeyStore?: SeenKeyStore | null): string {
  return expandInlineReferences(text, seenKeyStore ? buildDirectory(configPeers, seenKeyStore) : configPeers);
}

export function compactInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return compactInlineReferences(text, configPeers);
}
