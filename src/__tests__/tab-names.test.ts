import { describe, it, expect } from 'vitest';
import type { AgoraPeerConfig } from '@rookdaemon/agora';

/**
 * Helper function to format a peer name for tab display.
 * This logic should match what's in upsertGroupTab in the browser code.
 */
function formatTabName(peerKey: string, configPeers: Record<string, AgoraPeerConfig>): string {
  const peer = Object.values(configPeers || {}).find(p => p?.publicKey === peerKey);
  return peer?.name ? (peer.name + '@' + peerKey.slice(-8)) : ('@' + peerKey.slice(-8));
}

describe('Tab name resolution', () => {
  it('should format name@suffix when peer found in configPeers keyed by publicKey', () => {
    const publicKey = '302a300506032b65700321006d683326589a22076a78997ed013c6f47fa3d8faed79e71e03ce84de11251b69';
    const configPeers: Record<string, AgoraPeerConfig> = {
      [publicKey]: {
        publicKey,
        name: 'rook'
      }
    };

    expect(formatTabName(publicKey, configPeers)).toBe('rook@11251b69');
  });

  it('should format name@suffix when peer found in configPeers keyed by name', () => {
    const publicKey = '302a300506032b6570032100c46059701dc810ed45ec3bed714e84aa46b67893eb4c26f4f3d87f8ae914f02f';
    const configPeers: Record<string, AgoraPeerConfig> = {
      'bishop': {
        publicKey,
        name: 'bishop'
      }
    };

    expect(formatTabName(publicKey, configPeers)).toBe('bishop@e914f02f');
  });

  it('should format @suffix when peer not found in configPeers', () => {
    const publicKey = '302a300506032b65700321001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const configPeers: Record<string, AgoraPeerConfig> = {};

    expect(formatTabName(publicKey, configPeers)).toBe('@90abcdef');
  });

  it('should handle mixed key structure (some by publicKey, some by name)', () => {
    const rookKey = '302a300506032b65700321006d683326589a22076a78997ed013c6f47fa3d8faed79e71e03ce84de11251b69';
    const bishopKey = '302a300506032b6570032100c46059701dc810ed45ec3bed714e84aa46b67893eb4c26f4f3d87f8ae914f02f';
    const configPeers: Record<string, AgoraPeerConfig> = {
      [rookKey]: {
        publicKey: rookKey,
        name: 'rook'
      },
      'bishop': {
        publicKey: bishopKey,
        name: 'bishop'
      }
    };

    expect(formatTabName(rookKey, configPeers)).toBe('rook@11251b69');
    expect(formatTabName(bishopKey, configPeers)).toBe('bishop@e914f02f');
  });

  it('should handle peer with no name field', () => {
    const publicKey = '302a300506032b65700321006d683326589a22076a78997ed013c6f47fa3d8faed79e71e03ce84de11251b69';
    const configPeers: Record<string, AgoraPeerConfig> = {
      [publicKey]: {
        publicKey
        // no name field
      }
    };

    expect(formatTabName(publicKey, configPeers)).toBe('@11251b69');
  });

  it('should handle empty configPeers', () => {
    const publicKey = '302a300506032b65700321006d683326589a22076a78997ed013c6f47fa3d8faed79e71e03ce84de11251b69';
    
    expect(formatTabName(publicKey, {})).toBe('@11251b69');
  });

  it('should handle undefined configPeers', () => {
    const publicKey = '302a300506032b65700321006d683326589a22076a78997ed013c6f47fa3d8faed79e71e03ce84de11251b69';
    
    expect(formatTabName(publicKey, undefined as any)).toBe('@11251b69');
  });

  it('should format group tab labels correctly', () => {
    const rookKey = '302a300506032b65700321006d683326589a22076a78997ed013c6f47fa3d8faed79e71e03ce84de11251b69';
    const bishopKey = '302a300506032b6570032100c46059701dc810ed45ec3bed714e84aa46b67893eb4c26f4f3d87f8ae914f02f';
    const configPeers: Record<string, AgoraPeerConfig> = {
      [rookKey]: { publicKey: rookKey, name: 'rook' },
      'bishop': { publicKey: bishopKey, name: 'bishop' }
    };

    const recipients = [rookKey, bishopKey];
    const label = recipients.map(key => formatTabName(key, configPeers)).join(', ');

    expect(label).toBe('rook@11251b69, bishop@e914f02f');
  });
});
