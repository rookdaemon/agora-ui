import { describe, it, expect } from 'vitest';
import { compactInlineRefs, expandInlineRefs, expandPeerRef, shortenPeerId } from '../utils.js';

const ALICE = '302a300506032b6570032100aaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000';
const BOB = '302a300506032b6570032100111122223333444455556666777788889999aaaabbbbccccddddeeeeffff1234';

const configPeers = {
  alice: { publicKey: ALICE, name: 'alice' },
  bob: { publicKey: BOB, name: 'bob' },
};

describe('peer reference helpers', () => {
  it('uses canonical name@suffix short format when name exists', () => {
    expect(shortenPeerId(ALICE, configPeers)).toBe('alice@99990000');
  });

  it('expands short references to full IDs', () => {
    expect(expandPeerRef('alice', configPeers)).toBe(ALICE);
    expect(expandPeerRef('alice@99990000', configPeers)).toBe(ALICE);
    expect(expandPeerRef('@99990000', configPeers)).toBe(ALICE);
    // Legacy formats still work
    expect(expandPeerRef('alice...99990000', configPeers)).toBe(ALICE);
    expect(expandPeerRef('...99990000', configPeers)).toBe(ALICE);
  });

  it('expands and compacts inline @references', () => {
    expect(expandInlineRefs('ping @alice@99990000', configPeers)).toBe(`ping @${ALICE}`);
    expect(compactInlineRefs(`ping @${ALICE}`, configPeers)).toBe('ping @alice@99990000');
  });

  it('leaves unknown inline tokens untouched', () => {
    expect(expandInlineRefs('ping @not-a-peer', configPeers)).toBe('ping @not-a-peer');
    expect(compactInlineRefs('ping @not-a-peer', configPeers)).toBe('ping @not-a-peer');
  });

  it('resolves peer names without seenKeyStore', () => {
    // Regression test for expandPeerRef building proper directory format
    // even when seenKeyStore is undefined
    expect(expandPeerRef('alice', configPeers)).toBe(ALICE);
    expect(expandPeerRef('bob', configPeers)).toBe(BOB);
    expect(expandPeerRef('alice', configPeers, undefined)).toBe(ALICE);
    expect(expandPeerRef('alice', configPeers, null)).toBe(ALICE);
  });

  it('works with empty configPeers object', () => {
    // Regression test for handling undefined/empty peers
    expect(expandPeerRef('alice', {})).toBeUndefined();
    expect(expandPeerRef('alice', {}, null)).toBeUndefined();
  });

  it('resolves peers when configPeers is keyed by publicKey', () => {
    // Real-world scenario: agora config files key peers by public key, not name
    const configPeersByKey = {
      [ALICE]: { publicKey: ALICE, name: 'alice' },
      [BOB]: { publicKey: BOB, name: 'bob' },
    };

    // Should resolve by name
    expect(expandPeerRef('alice', configPeersByKey)).toBe(ALICE);
    expect(expandPeerRef('bob', configPeersByKey)).toBe(BOB);

    // Should also resolve by key
    expect(expandPeerRef(ALICE, configPeersByKey)).toBe(ALICE);
    expect(expandPeerRef(BOB, configPeersByKey)).toBe(BOB);
  });

  it('resolves peers regardless of configPeers key structure', () => {
    // Should work whether peers are keyed by name or by public key
    const byName = {
      alice: { publicKey: ALICE, name: 'alice' },
      bob: { publicKey: BOB, name: 'bob' },
    };

    const byKey = {
      [ALICE]: { publicKey: ALICE, name: 'alice' },
      [BOB]: { publicKey: BOB, name: 'bob' },
    };

    // Both should resolve by name
    expect(expandPeerRef('alice', byName)).toBe(ALICE);
    expect(expandPeerRef('alice', byKey)).toBe(ALICE);

    // Both should resolve by key
    expect(expandPeerRef(ALICE, byName)).toBe(ALICE);
    expect(expandPeerRef(ALICE, byKey)).toBe(ALICE);
  });

  it('does not depend on configPeers key ordering or structure', () => {
    // Multiple ways to organize the same peers should all work
    const shuffled = {
      [BOB]: { publicKey: BOB, name: 'bob' },
      [ALICE]: { publicKey: ALICE, name: 'alice' },
    };

    expect(expandPeerRef('alice', shuffled)).toBe(ALICE);
    expect(expandPeerRef('bob', shuffled)).toBe(BOB);
    expect(expandPeerRef(ALICE, shuffled)).toBe(ALICE);
    expect(expandPeerRef(BOB, shuffled)).toBe(BOB);
  });

  it('handles malformed peer entries gracefully', () => {
    const mixed = {
      alice: { publicKey: ALICE, name: 'alice' },
      bad1: null,
      bad2: undefined,
      bad3: { name: 'broken' }, // missing publicKey
      bob: { publicKey: BOB, name: 'bob' },
    };

    // Should still resolve valid peers
    expect(expandPeerRef('alice', mixed as any)).toBe(ALICE);
    expect(expandPeerRef('bob', mixed as any)).toBe(BOB);

    // Should not crash on malformed entries
    expect(expandPeerRef('broken', mixed as any)).toBeUndefined();
  });
});
