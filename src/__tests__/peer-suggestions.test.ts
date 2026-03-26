import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findUnknownPeers, addPeerToConfig } from '../peer-suggestions.js';

describe('findUnknownPeers', () => {
  const selfKey = 'self-public-key-000';
  const configPeers = {
    'known-peer-aaa': { publicKey: 'known-peer-aaa', name: 'Alice' },
    'known-peer-bbb': { publicKey: 'known-peer-bbb', name: 'Bob' },
  };

  it('returns empty array when all recipients are in configPeers', () => {
    const result = findUnknownPeers(['known-peer-aaa', 'known-peer-bbb'], configPeers, selfKey);
    expect(result).toEqual([]);
  });

  it('returns unknown peer keys', () => {
    const result = findUnknownPeers(['known-peer-aaa', 'unknown-peer-ccc'], configPeers, selfKey);
    expect(result).toEqual(['unknown-peer-ccc']);
  });

  it('excludes self key from results', () => {
    const result = findUnknownPeers([selfKey, 'unknown-peer-ccc'], configPeers, selfKey);
    expect(result).toEqual(['unknown-peer-ccc']);
  });

  it('returns empty array for empty recipients', () => {
    const result = findUnknownPeers([], configPeers, selfKey);
    expect(result).toEqual([]);
  });

  it('deduplicates unknown peers', () => {
    const result = findUnknownPeers(['unknown-peer-ccc', 'unknown-peer-ccc'], configPeers, selfKey);
    expect(result).toEqual(['unknown-peer-ccc']);
  });

  it('handles self key being in configPeers (common pattern)', () => {
    const peersWithSelf = { ...configPeers, [selfKey]: { publicKey: selfKey, name: 'Me' } };
    const result = findUnknownPeers([selfKey, 'unknown-peer-ccc'], peersWithSelf, selfKey);
    expect(result).toEqual(['unknown-peer-ccc']);
  });
});

describe('addPeerToConfig', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), 'agora-ui-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, 'config.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a new peer to existing config with peers', () => {
    writeFileSync(configPath, JSON.stringify({
      identity: { publicKey: 'my-key', privateKey: 'my-secret' },
      relay: { url: 'wss://relay.example.com' },
      peers: {
        Alice: { publicKey: 'alice-key', name: 'Alice' },
      },
    }, null, 2));

    const result = addPeerToConfig(configPath, 'charlie-key', 'Charlie');
    expect(result.ok).toBe(true);

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.peers.Charlie).toEqual({ publicKey: 'charlie-key', name: 'Charlie' });
    // Existing peer preserved
    expect(updated.peers.Alice).toEqual({ publicKey: 'alice-key', name: 'Alice' });
  });

  it('adds a peer to config with no existing peers section', () => {
    writeFileSync(configPath, JSON.stringify({
      identity: { publicKey: 'my-key', privateKey: 'my-secret' },
    }, null, 2));

    const result = addPeerToConfig(configPath, 'bob-key', 'Bob');
    expect(result.ok).toBe(true);

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.peers.Bob).toEqual({ publicKey: 'bob-key', name: 'Bob' });
  });

  it('adds peer with key-based name when no name provided', () => {
    writeFileSync(configPath, JSON.stringify({
      identity: { publicKey: 'my-key', privateKey: 'my-secret' },
      peers: {},
    }, null, 2));

    const result = addPeerToConfig(configPath, 'abcdef1234567890', undefined);
    expect(result.ok).toBe(true);

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    // Should use last 8 chars as key
    expect(updated.peers['34567890']).toEqual({ publicKey: 'abcdef1234567890' });
  });

  it('does not overwrite existing peer with same name', () => {
    writeFileSync(configPath, JSON.stringify({
      identity: { publicKey: 'my-key', privateKey: 'my-secret' },
      peers: {
        Alice: { publicKey: 'alice-key-original', name: 'Alice' },
      },
    }, null, 2));

    const result = addPeerToConfig(configPath, 'alice-key-new', 'Alice');
    expect(result.ok).toBe(true);

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    // Original peer preserved — new one uses disambiguated key
    expect(updated.peers.Alice.publicKey).toBe('alice-key-original');
  });

  it('returns error for non-existent config', () => {
    const result = addPeerToConfig('/tmp/does-not-exist-config.json', 'key', 'Name');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('preserves config formatting (2-space indent)', () => {
    const original = JSON.stringify({
      identity: { publicKey: 'my-key', privateKey: 'my-secret' },
      peers: {},
    }, null, 2);
    writeFileSync(configPath, original);

    addPeerToConfig(configPath, 'new-key', 'NewPeer');

    const content = readFileSync(configPath, 'utf-8');
    // Should be indented with 2 spaces
    expect(content).toContain('  "peers"');
  });
});
