import { describe, expect, it } from 'vitest';
import type { AgoraPeerConfig } from '@rookdaemon/agora';
import { normalizeRecipientsForGrouping, resolveLocalName } from '../server.js';

describe('server local identity resolution', () => {
    const selfKey = '302a300506032b6570032100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9f38f6d0';

    it('prefers broadcastName when provided', () => {
        const peers: Record<string, AgoraPeerConfig> = {
            stefan: { publicKey: selfKey, name: 'other' },
        };

        const name = resolveLocalName(selfKey, 'stefan', peers, '@9f38f6d0');
        expect(name).toBe('stefan');
    });

    it('falls back to config peers matching own public key', () => {
        const peers: Record<string, AgoraPeerConfig> = {
            stefan: { publicKey: selfKey, name: 'stefan' },
            rook: { publicKey: '302a300506032b6570032100bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb11251b69', name: 'rook' },
        };

        const name = resolveLocalName(selfKey, undefined, peers, '@9f38f6d0');
        expect(name).toBe('stefan');
    });

    it('falls back to parsed display name when config has no self mapping', () => {
        const peers: Record<string, AgoraPeerConfig> = {
            rook: { publicKey: '302a300506032b6570032100bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb11251b69', name: 'rook' },
        };

        const name = resolveLocalName(selfKey, undefined, peers, 'stefan@9f38f6d0');
        expect(name).toBe('stefan');
    });

    it('returns undefined when no name source is available', () => {
        const peers: Record<string, AgoraPeerConfig> = {};

        const name = resolveLocalName(selfKey, undefined, peers, '@9f38f6d0');
        expect(name).toBeUndefined();
    });
});

describe('server recipient grouping normalization', () => {
    const selfKey = 'self-key';
    const rookKey = 'rook-key';
    const novaKey = 'nova-key';

    it('deduplicates, excludes self, and sorts', () => {
        const result = normalizeRecipientsForGrouping([novaKey, selfKey, rookKey, novaKey], selfKey);
        expect(result).toEqual([novaKey, rookKey].sort());
    });

    it('removes empty values', () => {
        const result = normalizeRecipientsForGrouping([rookKey, '', novaKey, ''], selfKey);
        expect(result).toEqual([novaKey, rookKey].sort());
    });

    it('returns empty when only self remains', () => {
        const result = normalizeRecipientsForGrouping([selfKey, selfKey], selfKey);
        expect(result).toEqual([]);
    });
});
