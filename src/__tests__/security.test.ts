import { describe, it, expect } from 'vitest';
import type { Envelope } from '@rookdaemon/agora';
import { InboundMessageGuard } from '../security.js';

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env-1',
    type: 'publish',
    sender: 'sender-key',
    timestamp: Date.now(),
    payload: { text: 'hello' },
    signature: 'sig',
    ...overrides,
  } as Envelope;
}

describe('InboundMessageGuard', () => {
  it('drops ignored peers', () => {
    const guard = new InboundMessageGuard({ ignoredPeers: ['sender-key'] });
    const result = guard.shouldDrop(envelope(), 'sender-key');
    expect(result.drop).toBe(true);
    expect(result.reason).toBe('ignored_peer');
  });

  it('drops duplicate envelope IDs', () => {
    const guard = new InboundMessageGuard();
    const first = guard.shouldDrop(envelope({ id: 'same-id' }), 'sender-key');
    const second = guard.shouldDrop(envelope({ id: 'same-id' }), 'sender-key');
    expect(first.drop).toBe(false);
    expect(second.drop).toBe(true);
    expect(second.reason).toBe('duplicate_envelope_id');
  });

  it('drops duplicate content from same sender within window', () => {
    const guard = new InboundMessageGuard();
    const first = guard.shouldDrop(envelope({ id: 'a', payload: { text: 'same' } }), 'sender-key');
    const second = guard.shouldDrop(envelope({ id: 'b', payload: { text: 'same' } }), 'sender-key');
    expect(first.drop).toBe(false);
    expect(second.drop).toBe(true);
    expect(second.reason).toBe('duplicate_content');
  });

  it('enforces per-sender rate limit', () => {
    const guard = new InboundMessageGuard({
      rateLimitMaxMessages: 2,
      rateLimitWindowMs: 60_000,
      contentDedupEnabled: false,
    });

    const first = guard.shouldDrop(envelope({ id: '1', payload: { text: 'a' } }), 'sender-key');
    const second = guard.shouldDrop(envelope({ id: '2', payload: { text: 'b' } }), 'sender-key');
    const third = guard.shouldDrop(envelope({ id: '3', payload: { text: 'c' } }), 'sender-key');

    expect(first.drop).toBe(false);
    expect(second.drop).toBe(false);
    expect(third.drop).toBe(true);
    expect(third.reason).toBe('rate_limited');
  });

  it('supports ignore/unignore/list operations', () => {
    const guard = new InboundMessageGuard();
    expect(guard.listIgnoredPeers()).toEqual([]);
    expect(guard.ignorePeer('peer-z')).toBe(true);
    expect(guard.ignorePeer('peer-a')).toBe(true);
    expect(guard.ignorePeer('peer-z')).toBe(false);
    expect(guard.listIgnoredPeers()).toEqual(['peer-a', 'peer-z']);
    expect(guard.unignorePeer('peer-z')).toBe(true);
    expect(guard.listIgnoredPeers()).toEqual(['peer-a']);
  });
});
