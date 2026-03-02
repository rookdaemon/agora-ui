import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  formatMessageLine,
  parseMessageLine,
  appendToConversation,
  loadConversation,
  trimToByteLimit,
  MAX_CONVERSATION_BYTES,
} from '../conversation.js';
import type { Message } from '../types.js';

const TEST_DIR = '/tmp/agora-ui-conversation-test';
const TEST_FILE = join(TEST_DIR, 'CONVERSATION.md');

function makeMessage(from: string, text: string, timestamp = 1700000000000): Message {
  return { from, text, timestamp, isDM: false };
}

describe('formatMessageLine', () => {
  it('formats a message as a single line', () => {
    const msg = makeMessage('Alice', 'Hello there', 1700000000000);
    const line = formatMessageLine(msg);
    expect(line).toBe('[2023-11-14T22:13:20.000Z] [Alice] Hello there');
  });

  it('replaces newlines in text to preserve single-line format', () => {
    const msg = makeMessage('Bob', 'line1\nline2', 1700000000000);
    const line = formatMessageLine(msg);
    expect(line).not.toContain('\n');
    expect(line).toContain('line1 line2');
  });

  it('includes [DM] marker for direct messages', () => {
    const msg: Message = { from: 'Alice', text: '@Bob: hey', timestamp: 1700000000000, isDM: true };
    const line = formatMessageLine(msg);
    expect(line).toBe('[2023-11-14T22:13:20.000Z] [Alice] [DM] @Bob: hey');
  });

  it('does not include [DM] marker for non-DM messages', () => {
    const msg = makeMessage('Alice', 'Hello', 1700000000000);
    const line = formatMessageLine(msg);
    expect(line).not.toContain('[DM]');
  });

  it('replaces CRLF in text', () => {
    const msg = makeMessage('Carol', 'a\r\nb', 1700000000000);
    const line = formatMessageLine(msg);
    expect(line).not.toContain('\r');
    expect(line).not.toContain('\n');
    expect(line).toContain('a b');
  });
});

describe('parseMessageLine', () => {
  it('parses a valid formatted line', () => {
    const line = '[2023-11-14T22:13:20.000Z] [Alice] Hello there';
    const msg = parseMessageLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.from).toBe('Alice');
    expect(msg!.text).toBe('Hello there');
    expect(msg!.timestamp).toBe(new Date('2023-11-14T22:13:20.000Z').getTime());
  });

  it('returns null for invalid lines', () => {
    expect(parseMessageLine('')).toBeNull();
    expect(parseMessageLine('not a valid line')).toBeNull();
    expect(parseMessageLine('[bad-date] [Alice] text')).toBeNull();
  });

  it('parses isDM flag correctly for DM messages', () => {
    const line = '[2023-11-14T22:13:20.000Z] [Alice] [DM] @Bob: hey';
    const msg = parseMessageLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.isDM).toBe(true);
    expect(msg!.text).toBe('@Bob: hey');
    expect(msg!.peer).toBeUndefined();
  });

  it('parses isDM and peer from [DM:peerKey] format', () => {
    const line = '[2023-11-14T22:13:20.000Z] [Alice] [DM:abc123def456] @Bob: hey';
    const msg = parseMessageLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.isDM).toBe(true);
    expect(msg!.peer).toBe('abc123def456');
    expect(msg!.text).toBe('@Bob: hey');
  });

  it('parses isDM as false for non-DM messages', () => {
    const line = '[2023-11-14T22:13:20.000Z] [Alice] Hello there';
    const msg = parseMessageLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.isDM).toBe(false);
  });

  it('roundtrips isDM=true (no peer) through format and parse', () => {
    const original: Message = { from: 'Alice', text: '@Bob: hello', timestamp: 1700000000000, isDM: true };
    const line = formatMessageLine(original);
    const parsed = parseMessageLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.isDM).toBe(true);
    expect(parsed!.peer).toBeUndefined();
    expect(parsed!.text).toBe('@Bob: hello');
  });

  it('roundtrips isDM=true with peer through format and parse', () => {
    const original: Message = { from: 'Alice', text: 'hello', timestamp: 1700000000000, isDM: true, peer: 'abc123def456' };
    const line = formatMessageLine(original);
    expect(line).toContain('[DM:abc123def456]');
    const parsed = parseMessageLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.isDM).toBe(true);
    expect(parsed!.peer).toBe('abc123def456');
    expect(parsed!.text).toBe('hello');
  });

  it('roundtrips through format and parse', () => {
    const original = makeMessage('Dave (...abc12345)', 'test message', 1700000000000);
    const line = formatMessageLine(original);
    const parsed = parseMessageLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.from).toBe(original.from);
    expect(parsed!.text).toBe(original.text);
    expect(parsed!.timestamp).toBe(original.timestamp);
  });

  it('handles empty text', () => {
    const line = '[2023-11-14T22:13:20.000Z] [Alice] ';
    const msg = parseMessageLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('');
  });
});

describe('appendToConversation', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('creates the file if it does not exist', () => {
    const msg = makeMessage('Alice', 'Hello');
    appendToConversation(msg, TEST_FILE);
    expect(existsSync(TEST_FILE)).toBe(true);
  });

  it('writes the message in the correct format', () => {
    const msg = makeMessage('Alice', 'Hello', 1700000000000);
    appendToConversation(msg, TEST_FILE);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('[Alice]');
    expect(content).toContain('Hello');
  });

  it('appends multiple messages', () => {
    appendToConversation(makeMessage('Alice', 'First'), TEST_FILE);
    appendToConversation(makeMessage('Bob', 'Second'), TEST_FILE);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('[Alice]');
    expect(content).toContain('[Bob]');
  });

  it('creates parent directory if it does not exist', () => {
    const deepPath = join(TEST_DIR, 'subdir', 'CONVERSATION.md');
    const msg = makeMessage('Alice', 'Hello');
    appendToConversation(msg, deepPath);
    expect(existsSync(deepPath)).toBe(true);
  });

  it('retains full history on disk without truncation', () => {
    for (let i = 0; i < 80; i++) {
      appendToConversation(makeMessage('User', `message ${i}`, 1700000000000 + i * 1000), TEST_FILE);
    }
    const content = readFileSync(TEST_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBe(80);
    expect(content).toContain('message 0');
    expect(content).toContain('message 79');
  });
});

describe('loadConversation', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('returns empty array if file does not exist', () => {
    const result = loadConversation(TEST_FILE);
    expect(result).toEqual([]);
  });

  it('parses messages from file', () => {
    writeFileSync(TEST_FILE, '[2023-11-14T22:13:20.000Z] [Alice] Hello\n[2023-11-14T22:13:21.000Z] [Bob] Hi\n');
    const result = loadConversation(TEST_FILE);
    expect(result).toHaveLength(2);
    expect(result[0].from).toBe('Alice');
    expect(result[1].from).toBe('Bob');
  });

  it('skips invalid lines without failing', () => {
    writeFileSync(TEST_FILE, '[2023-11-14T22:13:20.000Z] [Alice] Hello\ninvalid line\n[2023-11-14T22:13:21.000Z] [Bob] Hi\n');
    const result = loadConversation(TEST_FILE);
    expect(result).toHaveLength(2);
  });

  it('roundtrips through append and load', () => {
    const messages: Message[] = [
      makeMessage('Alice', 'Hello', 1700000000000),
      makeMessage('Bob', 'Hi there', 1700000001000),
    ];
    messages.forEach(m => appendToConversation(m, TEST_FILE));
    const loaded = loadConversation(TEST_FILE);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].from).toBe('Alice');
    expect(loaded[0].text).toBe('Hello');
    expect(loaded[1].from).toBe('Bob');
    expect(loaded[1].text).toBe('Hi there');
  });

  it('returns only the most recent messages within MAX_CONVERSATION_BYTES', () => {
    for (let i = 0; i < 200; i++) {
      appendToConversation(makeMessage('User', `message ${i}`, 1700000000000 + i * 1000), TEST_FILE);
    }
    const loaded = loadConversation(TEST_FILE);
    // Full file should be much larger than 4KB, but loaded messages should fit
    const serialized = loaded.map(m => formatMessageLine(m)).join('\n') + '\n';
    expect(Buffer.byteLength(serialized, 'utf-8')).toBeLessThanOrEqual(MAX_CONVERSATION_BYTES);
    // Should include the newest message
    expect(loaded[loaded.length - 1].text).toBe('message 199');
    // Should NOT include the oldest
    expect(loaded.find(m => m.text === 'message 0')).toBeUndefined();
  });

  it('loads messages trimmed at even boundaries', () => {
    for (let i = 0; i < 200; i++) {
      appendToConversation(makeMessage('User', `message ${i}`, 1700000000000 + i * 1000), TEST_FILE);
    }
    const loaded = loadConversation(TEST_FILE);
    expect(loaded.length % 2).toBe(0);
  });
});
