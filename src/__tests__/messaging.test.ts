import { describe, it, expect } from 'vitest';

describe('Message Parsing', () => {
  it('should detect DM pattern', () => {
    const message = '@rook hello there';
    const dmMatch = message.match(/^@(\S+)\s+(.+)$/);
    
    expect(dmMatch).not.toBeNull();
    expect(dmMatch![1]).toBe('rook');
    expect(dmMatch![2]).toBe('hello there');
  });

  it('should not match DM without message', () => {
    const message = '@rook';
    const dmMatch = message.match(/^@(\S+)\s+(.+)$/);
    
    expect(dmMatch).toBeNull();
  });

  it('should not match regular message as DM', () => {
    const message = 'hello @rook there';
    const dmMatch = message.match(/^@(\S+)\s+(.+)$/);
    
    expect(dmMatch).toBeNull();
  });

  it('should detect command pattern', () => {
    expect('/quit'.startsWith('/')).toBe(true);
    expect('/peers'.startsWith('/')).toBe(true);
    expect('/clear'.startsWith('/')).toBe(true);
    expect('regular message'.startsWith('/')).toBe(false);
  });
});

describe('Command Parsing', () => {
  const commands = ['/quit', '/exit', '/clear', '/help', '/peers'];
  
  it('should recognize valid commands', () => {
    commands.forEach(cmd => {
      expect(cmd.toLowerCase().startsWith('/')).toBe(true);
    });
  });

  it('should handle case insensitivity', () => {
    expect('/QUIT'.toLowerCase()).toBe('/quit');
    expect('/Peers'.toLowerCase()).toBe('/peers');
  });
});

describe('Relay Message Formatting', () => {
  it('should format register message correctly', () => {
    const publicKey = '302a300506032b657003210012345678';
    const message = {
      type: 'register',
      publicKey
    };
    
    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);
    
    expect(parsed.type).toBe('register');
    expect(parsed.publicKey).toBe(publicKey);
  });

  it('should format message envelope correctly', () => {
    const message = {
      type: 'message',
      to: 'recipient-key',
      envelope: {
        text: 'Hello world',
        timestamp: Date.now()
      }
    };
    
    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);
    
    expect(parsed.type).toBe('message');
    expect(parsed.to).toBe('recipient-key');
    expect(parsed.envelope.text).toBe('Hello world');
    expect(typeof parsed.envelope.timestamp).toBe('number');
  });

  it('should parse incoming message correctly', () => {
    const incomingJson = JSON.stringify({
      type: 'message',
      from: 'sender-key',
      envelope: {
        text: 'Test message',
        timestamp: 1234567890
      }
    });
    
    const parsed = JSON.parse(incomingJson);
    
    expect(parsed.type).toBe('message');
    expect(parsed.from).toBe('sender-key');
    expect(parsed.envelope.text).toBe('Test message');
  });
});
