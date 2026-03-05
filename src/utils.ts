import { formatDisplayName, sanitizeText, resolveDisplayName, shorten, expand, expandInlineReferences, compactInlineReferences } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';

export { formatDisplayName, sanitizeText, resolveDisplayName };

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

export function expandPeerRef(reference: string, configPeers: Record<string, AgoraPeerConfig>): string | undefined {
  return expand(reference, configPeers);
}

export function expandInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return expandInlineReferences(text, configPeers);
}

export function compactInlineRefs(text: string, configPeers: Record<string, AgoraPeerConfig>): string {
  return compactInlineReferences(text, configPeers);
}
