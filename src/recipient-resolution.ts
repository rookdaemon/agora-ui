import type { AgoraPeerConfig, SeenKeyStore } from '@rookdaemon/agora';
import { expandPeerRef } from './utils.js';

export interface RecipientResolution {
  recipient?: string;
  reason?: string;
}

export interface RecipientBatchResolution {
  recipients: string[];
  issues: string[];
}

export function isLikelyPublicKey(value: string): boolean {
  return /^[0-9a-fA-F]{16,}$/.test(value.trim());
}

export function resolveRecipientReference(
  reference: string,
  configPeers: Record<string, AgoraPeerConfig>,
  peers: Map<string, string>,
  seenKeyStore?: SeenKeyStore | null,
): RecipientResolution {
  const token = reference.trim();
  if (!token) {
    return { reason: 'empty recipient' };
  }

  if (isLikelyPublicKey(token)) {
    return { recipient: token };
  }

  const byConfig = expandPeerRef(token, configPeers, seenKeyStore);
  if (byConfig) {
    return { recipient: byConfig };
  }

  const matches = Array.from(peers.entries()).filter(([peerKey, displayName]) => (
    peerKey === token ||
    peerKey.startsWith(token) ||
    displayName === token ||
    displayName.startsWith(token) ||
    displayName.includes(token)
  ));

  if (matches.length === 1) {
    return { recipient: matches[0][0] };
  }

  if (matches.length > 1) {
    const options = matches
      .slice(0, 3)
      .map(([peerKey, displayName]) => `${displayName} (${peerKey.slice(0, 10)}…)`)
      .join(', ');
    return { reason: `ambiguous recipient '${token}' (${options})` };
  }

  return { reason: `unresolved recipient '${token}'` };
}

export function resolveRecipientReferences(
  references: string[],
  configPeers: Record<string, AgoraPeerConfig>,
  peers: Map<string, string>,
  seenKeyStore?: SeenKeyStore | null,
): RecipientBatchResolution {
  const recipients: string[] = [];
  const issues: string[] = [];

  for (const raw of references) {
    const match = resolveRecipientReference(raw, configPeers, peers, seenKeyStore);
    if (match.recipient) {
      recipients.push(match.recipient);
    } else {
      issues.push(match.reason ?? `unresolved recipient '${raw}'`);
    }
  }

  return { recipients, issues };
}
