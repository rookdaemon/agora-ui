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
});
