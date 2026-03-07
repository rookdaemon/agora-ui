import { describe, it, expect } from 'vitest';
import { resolveRecipientReference, resolveRecipientReferences } from '../recipient-resolution.js';

const NOVA = '302a300506032b6570032100aaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000';
const ROOK = '302a300506032b6570032100111122223333444455556666777788889999aaaabbbbccccddddeeeeffff1234';

const configPeers = {
    nova: { publicKey: NOVA, name: 'nova' },
    rook: { publicKey: ROOK, name: 'rook' },
};

describe('recipient resolution', () => {
    it('resolves known peer name (nova) to full public key', () => {
        const peers = new Map<string, string>();
        const result = resolveRecipientReference('nova', configPeers, peers);
        expect(result.recipient).toBe(NOVA);
        expect(result.reason).toBeUndefined();
    });

    it('resolves canonical short reference to full public key', () => {
        const peers = new Map<string, string>();
        const result = resolveRecipientReference('nova@99990000', configPeers, peers);
        expect(result.recipient).toBe(NOVA);
    });

    it('returns unresolved reason for unknown recipient names', () => {
        const peers = new Map<string, string>();
        const result = resolveRecipientReference('unknown-peer', configPeers, peers);
        expect(result.recipient).toBeUndefined();
        expect(result.reason).toContain("unresolved recipient 'unknown-peer'");
    });

    it('returns explicit reason when config maps name to non-key value', () => {
        const peers = new Map<string, string>();
        const badConfig = {
            nova: { publicKey: 'nova', name: 'nova' },
        };
        const result = resolveRecipientReference('nova', badConfig, peers);
        expect(result.recipient).toBeUndefined();
        expect(result.reason).toContain("maps to non-key value 'nova' in config");
    });

    it('returns explicit reason when online peer id is not a public key', () => {
        const peers = new Map<string, string>([['nova', 'nova']]);
        const result = resolveRecipientReference('nova', {}, peers);
        expect(result.recipient).toBeUndefined();
        expect(result.reason).toContain("resolved to non-key online id 'nova'");
    });

    it('returns ambiguous reason when multiple online matches exist', () => {
        const peers = new Map<string, string>([
            [NOVA, 'nova@99990000'],
            [ROOK, 'nova-helper@ffff1234'],
        ]);
        const result = resolveRecipientReference('nova', {}, peers);
        expect(result.recipient).toBeUndefined();
        expect(result.reason).toContain("ambiguous recipient 'nova'");
    });

    it('resolves batches and reports per-recipient issues', () => {
        const peers = new Map<string, string>([[ROOK, 'rook@ffff1234']]);
        const batch = resolveRecipientReferences(['nova', 'rook', 'missing'], configPeers, peers);
        expect(batch.recipients).toContain(NOVA);
        expect(batch.recipients).toContain(ROOK);
        expect(batch.issues.some((issue) => issue.includes("unresolved recipient 'missing'"))).toBe(true);
    });
});
