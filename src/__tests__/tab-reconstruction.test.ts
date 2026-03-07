import { describe, it, expect } from 'vitest';
import type { Message } from '../types.js';
import type { AgoraPeerConfig } from '@rookdaemon/agora';

/**
 * Helper to extract DM tabs from message history
 */
function extractDmTabs(messages: Message[]): Map<string, string[]> {
  const dmRecipients = new Map<string, string[]>();
  for (const msg of messages) {
    if (msg.to && msg.to.length === 1) {
      const recipient = msg.to[0];
      if (!dmRecipients.has(recipient)) {
        dmRecipients.set(recipient, [recipient]);
      }
    }
  }
  return dmRecipients;
}

/**
 * Helper to extract group tabs from message history
 */
function extractGroupTabs(messages: Message[]): Map<string, string[]> {
  const groupRecipients = new Map<string, string[]>();
  for (const msg of messages) {
    if (msg.to && msg.to.length > 1) {
      const sorted = Array.from(new Set(msg.to)).sort();
      const key = sorted.join('|');
      if (!groupRecipients.has(key)) {
        groupRecipients.set(key, sorted);
      }
    }
  }
  return groupRecipients;
}

/**
 * Helper to check if local user is in peers list
 */
function includeLocalUserInPeers(
  peers: Map<string, string>,
  localPublicKey: string,
  localDisplayName: string
): Map<string, string> {
  const peersWithSelf = new Map(peers);
  peersWithSelf.set(localPublicKey, localDisplayName);
  return peersWithSelf;
}

describe('Tab reconstruction on reload', () => {
  const aliceKey = '302a300506032b65700321001111111111111111111111111111111111111111111111111111111111111111';
  const bobKey = '302a300506032b65700321002222222222222222222222222222222222222222222222222222222222222222';
  const carolKey = '302a300506032b65700321003333333333333333333333333333333333333333333333333333333333333333';
  const localKey = '302a300506032b65700321004444444444444444444444444444444444444444444444444444444444444444';

  describe('DM tab extraction', () => {
    it('should extract unique DM recipients from messages', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'Hi', timestamp: 1000, to: [bobKey] },
        { from: 'bob@22222222', text: 'Hey', timestamp: 1001, to: [aliceKey] },
        { from: 'alice@11111111', text: 'How are you?', timestamp: 1002, to: [bobKey] },
      ];

      const dmTabs = extractDmTabs(messages);
      
      expect(dmTabs.size).toBe(2);
      expect(dmTabs.has(bobKey)).toBe(true);
      expect(dmTabs.has(aliceKey)).toBe(true);
    });

    it('should handle DMs to self', () => {
      const messages: Message[] = [
        { from: 'me@44444444', text: 'Note to self', timestamp: 1000, to: [localKey] },
        { from: 'alice@11111111', text: 'Hi', timestamp: 1001, to: [localKey] },
      ];

      const dmTabs = extractDmTabs(messages);
      
      expect(dmTabs.size).toBe(1);
      expect(dmTabs.has(localKey)).toBe(true);
    });

    it('should not create DM tabs for group messages', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'Group msg', timestamp: 1000, to: [bobKey, carolKey] },
      ];

      const dmTabs = extractDmTabs(messages);
      
      expect(dmTabs.size).toBe(0);
    });

    it('should handle empty message history', () => {
      const messages: Message[] = [];
      const dmTabs = extractDmTabs(messages);
      
      expect(dmTabs.size).toBe(0);
    });
  });

  describe('Group tab extraction', () => {
    it('should extract unique group recipients from messages', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'Group msg', timestamp: 1000, to: [bobKey, carolKey] },
        { from: 'bob@22222222', text: 'Reply', timestamp: 1001, to: [aliceKey, carolKey] },
      ];

      const groupTabs = extractGroupTabs(messages);
      
      expect(groupTabs.size).toBe(2);
      expect(groupTabs.has([bobKey, carolKey].sort().join('|'))).toBe(true);
      expect(groupTabs.has([aliceKey, carolKey].sort().join('|'))).toBe(true);
    });

    it('should normalize recipient order (sort)', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'Msg 1', timestamp: 1000, to: [carolKey, bobKey] },
        { from: 'bob@22222222', text: 'Msg 2', timestamp: 1001, to: [bobKey, carolKey] },
      ];

      const groupTabs = extractGroupTabs(messages);
      
      // Both messages have same recipients, just different order - should be 1 tab
      expect(groupTabs.size).toBe(1);
      const key = [bobKey, carolKey].sort().join('|');
      expect(groupTabs.has(key)).toBe(true);
    });

    it('should deduplicate recipients within a message', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'Msg', timestamp: 1000, to: [bobKey, bobKey, carolKey] },
      ];

      const groupTabs = extractGroupTabs(messages);
      
      expect(groupTabs.size).toBe(1);
      const key = [bobKey, carolKey].sort().join('|');
      const recipients = groupTabs.get(key);
      expect(recipients).toEqual([bobKey, carolKey].sort());
    });

    it('should not create group tabs for DMs', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'DM', timestamp: 1000, to: [bobKey] },
      ];

      const groupTabs = extractGroupTabs(messages);
      
      expect(groupTabs.size).toBe(0);
    });

    it('should handle mixed DM and group messages', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'DM to bob', timestamp: 1000, to: [bobKey] },
        { from: 'alice@11111111', text: 'Group', timestamp: 1001, to: [bobKey, carolKey] },
        { from: 'bob@22222222', text: 'DM to alice', timestamp: 1002, to: [aliceKey] },
      ];

      const dmTabs = extractDmTabs(messages);
      const groupTabs = extractGroupTabs(messages);
      
      expect(dmTabs.size).toBe(2); // bob, alice
      expect(groupTabs.size).toBe(1); // bob+carol
    });

    it('should handle three-way and larger groups', () => {
      const messages: Message[] = [
        { from: 'alice@11111111', text: 'Three way', timestamp: 1000, to: [bobKey, carolKey, localKey] },
        { from: 'bob@22222222', text: 'Four way', timestamp: 1001, to: [aliceKey, carolKey, localKey] },
      ];

      const groupTabs = extractGroupTabs(messages);
      
      expect(groupTabs.size).toBe(2);
    });
  });

  describe('Local user in peers list', () => {
    it('should include local user in peers list', () => {
      const peers = new Map<string, string>([
        [aliceKey, 'alice@11111111'],
        [bobKey, 'bob@22222222'],
      ]);

      const peersWithSelf = includeLocalUserInPeers(peers, localKey, 'me@44444444');
      
      expect(peersWithSelf.size).toBe(3);
      expect(peersWithSelf.has(localKey)).toBe(true);
      expect(peersWithSelf.get(localKey)).toBe('me@44444444');
    });

    it('should not duplicate local user if already present', () => {
      const peers = new Map<string, string>([
        [aliceKey, 'alice@11111111'],
        [localKey, 'old_name@44444444'],
      ]);

      const peersWithSelf = includeLocalUserInPeers(peers, localKey, 'me@44444444');
      
      expect(peersWithSelf.size).toBe(2);
      // Should overwrite with new name
      expect(peersWithSelf.get(localKey)).toBe('me@44444444');
    });

    it('should work with empty peers list', () => {
      const peers = new Map<string, string>();
      const peersWithSelf = includeLocalUserInPeers(peers, localKey, 'me@44444444');
      
      expect(peersWithSelf.size).toBe(1);
      expect(peersWithSelf.get(localKey)).toBe('me@44444444');
    });

    it('should not modify original peers map', () => {
      const peers = new Map<string, string>([
        [aliceKey, 'alice@11111111'],
      ]);
      const originalSize = peers.size;

      includeLocalUserInPeers(peers, localKey, 'me@44444444');
      
      expect(peers.size).toBe(originalSize);
      expect(peers.has(localKey)).toBe(false);
    });
  });

  describe('Local user in configPeers', () => {
    it('should include local user in configPeers for lookups', () => {
      const configPeers: Record<string, AgoraPeerConfig> = {
        [aliceKey]: { publicKey: aliceKey, name: 'alice' },
        [bobKey]: { publicKey: bobKey, name: 'bob' },
      };

      const configPeersWithSelf: Record<string, AgoraPeerConfig> = {
        ...configPeers,
        [localKey]: {
          publicKey: localKey,
          name: 'me',
        },
      };

      expect(Object.keys(configPeersWithSelf).length).toBe(3);
      expect(configPeersWithSelf[localKey]).toBeDefined();
      expect(configPeersWithSelf[localKey].name).toBe('me');
    });

    it('should allow lookup by publicKey for local user', () => {
      const configPeersWithSelf: Record<string, AgoraPeerConfig> = {
        [localKey]: {
          publicKey: localKey,
          name: 'stefan',
        },
      };

      const found = Object.values(configPeersWithSelf).find(p => p?.publicKey === localKey);
      
      expect(found).toBeDefined();
      expect(found?.name).toBe('stefan');
    });

    it('should preserve existing peers when adding self', () => {
      const configPeers: Record<string, AgoraPeerConfig> = {
        'alice': { publicKey: aliceKey, name: 'alice' },
        [bobKey]: { publicKey: bobKey, name: 'bob' },
      };

      const configPeersWithSelf: Record<string, AgoraPeerConfig> = {
        ...configPeers,
        [localKey]: { publicKey: localKey, name: 'me' },
      };

      expect(configPeersWithSelf['alice' as keyof typeof configPeersWithSelf]).toBeDefined();
      expect(configPeersWithSelf[bobKey as keyof typeof configPeersWithSelf]).toBeDefined();
      expect(configPeersWithSelf[localKey as keyof typeof configPeersWithSelf]).toBeDefined();
    });
  });
});
