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

const ALICE_KEY = '302a300506032b6570032100aaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000';
const BOB_KEY = '302a300506032b6570032100111122223333444455556666777788889999aaaabbbbccccddddeeeeffff1234';
const DIRECTORY = {
  [ALICE_KEY]: { publicKey: ALICE_KEY, name: 'alice' },
  [BOB_KEY]: { publicKey: BOB_KEY, name: 'bob' },
};

function makeMessage(from: string, text: string, timestamp = 1700000000000, to?: string[]): Message {
  return { from, text, timestamp, to };
}

describe('formatMessageLine', () => {
  it('formats a message with FROM/TO metadata', () => {
    const msg = makeMessage('alice@99990000', 'Hello there', 1700000000000, [BOB_KEY]);
    const line = formatMessageLine(msg, DIRECTORY);
    expect(line).toBe('[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234 Hello there');
  });

  it('formats (none) when no recipients', () => {
    const msg = makeMessage('alice@99990000', 'Hello', 1700000000000);
    const line = formatMessageLine(msg);
    expect(line).toContain('**TO:** (none)');
  });

  it('replaces newlines in text to preserve single-line format', () => {
    const msg = makeMessage('bob@ffff1234', 'line1\nline2', 1700000000000, [ALICE_KEY]);
    const line = formatMessageLine(msg, DIRECTORY);
    expect(line).not.toContain('\n');
    expect(line).toContain('line1 line2');
  });

  it('replaces CRLF in text', () => {
    const msg = makeMessage('alice@99990000', 'a\r\nb', 1700000000000, [BOB_KEY]);
    const line = formatMessageLine(msg, DIRECTORY);
    expect(line).not.toContain('\r');
    expect(line).not.toContain('\n');
    expect(line).toContain('a b');
  });

  it('formats multiple recipients', () => {
    const msg = makeMessage('alice@99990000', 'hi all', 1700000000000, [ALICE_KEY, BOB_KEY]);
    const line = formatMessageLine(msg, DIRECTORY);
    expect(line).toContain('**TO:** alice@99990000, bob@ffff1234');
  });
});

describe('parseMessageLine', () => {
  it('parses a valid FROM/TO line', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234 Hello there';
    const msg = parseMessageLine(line, DIRECTORY);
    expect(msg).not.toBeNull();
    expect(msg!.from).toBe('alice@99990000');
    expect(msg!.to).toEqual([BOB_KEY]);
    expect(msg!.text).toBe('Hello there');
    expect(msg!.timestamp).toBe(new Date('2023-11-14T22:13:20.000Z').getTime());
  });

  it('returns null for invalid lines', () => {
    expect(parseMessageLine('')).toBeNull();
    expect(parseMessageLine('not a valid line')).toBeNull();
    expect(parseMessageLine('[bad-date] **FROM:** a **TO:** b text')).toBeNull();
  });

  it('returns null for old-format lines', () => {
    expect(parseMessageLine('[2023-11-14T22:13:20.000Z] [Alice] Hello')).toBeNull();
    expect(parseMessageLine('[2023-11-14T22:13:20.000Z] [Alice] [DM] hello')).toBeNull();
  });

  it('parses (none) recipients as undefined to', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** (none) broadcast';
    const msg = parseMessageLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.to).toBeUndefined();
    expect(msg!.text).toBe('broadcast');
  });

  it('parses multiple recipients with directory', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** alice@99990000, bob@ffff1234 hi all';
    const msg = parseMessageLine(line, DIRECTORY);
    expect(msg).not.toBeNull();
    expect(msg!.to).toEqual([ALICE_KEY, BOB_KEY]);
  });

  it('parses real-like mixed-key peers and includes bishop recipient', () => {
    const SELF_KEY = '302a300506032b6570032100b01df4d4d0dbefe25ba8c03ed3e09c2126ff8f61b3ae02a9c80a97809f38f6d0';
    const NOVA_KEY = '302a300506032b657003210001e16c1faa9ebcfec73993085012a7a91f6e0138bb61ce73ff511a299499c2bd';
    const ROOK_KEY = '302a300506032b65700321006d683326589a22076a78997ed013c6f47fa3d8faed79e71e03ce84de11251b69';
    const BISHOP_KEY = '302a300506032b6570032100c46059701dc810ed45ec3bed714e84aa46b8e2df043f89e23979ff9067893eb4';

    // Mirrors real config shape where peers may be keyed by either key or alias.
    const mixedDirectory = {
      [SELF_KEY]: { publicKey: SELF_KEY, name: 'stefan' },
      [NOVA_KEY]: { publicKey: NOVA_KEY, name: 'nova' },
      [ROOK_KEY]: { publicKey: ROOK_KEY, name: 'rook' },
      bishop: { publicKey: BISHOP_KEY, name: 'bishop' },
    };

    const line = '[2026-03-07T14:46:56.578Z] **FROM:** @9f38f6d0 **TO:** nova@9499c2bd, rook@11251b69, bishop@67893eb4 Good news; Bishop is back!';
    const msg = parseMessageLine(line, mixedDirectory);

    expect(msg).not.toBeNull();
    expect(msg!.from).toBe('@9f38f6d0');
    expect(msg!.fromKey).toBe(SELF_KEY);
    expect(msg!.to).toEqual([NOVA_KEY, ROOK_KEY, BISHOP_KEY]);
    expect(msg!.text).toBe('Good news; Bishop is back!');
  });

  it('handles empty text', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234';
    const msg = parseMessageLine(line, DIRECTORY);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('');
  });

  it('roundtrips through format and parse', () => {
    const original = makeMessage('dave@abc12345', 'test message', 1700000000000, [BOB_KEY]);
    const line = formatMessageLine(original, DIRECTORY);
    const parsed = parseMessageLine(line, DIRECTORY);
    expect(parsed).not.toBeNull();
    expect(parsed!.from).toBe(original.from);
    expect(parsed!.to).toEqual(original.to);
    expect(parsed!.text).toBe(original.text);
    expect(parsed!.timestamp).toBe(original.timestamp);
  });

  it('roundtrips with multiple recipients', () => {
    const original = makeMessage('me@12345678', 'group msg', 1700000000000, [ALICE_KEY, BOB_KEY]);
    const line = formatMessageLine(original, DIRECTORY);
    const parsed = parseMessageLine(line, DIRECTORY);
    expect(parsed).not.toBeNull();
    expect(parsed!.to).toEqual([ALICE_KEY, BOB_KEY]);
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
    const msg = makeMessage('alice@99990000', 'Hello', 1700000000000, [BOB_KEY]);
    appendToConversation(msg, TEST_FILE, DIRECTORY);
    expect(existsSync(TEST_FILE)).toBe(true);
  });

  it('writes the message in FROM/TO format', () => {
    const msg = makeMessage('alice@99990000', 'Hello', 1700000000000, [BOB_KEY]);
    appendToConversation(msg, TEST_FILE, DIRECTORY);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('**FROM:** alice@99990000');
    expect(content).toContain('**TO:** bob@ffff1234');
    expect(content).toContain('Hello');
  });

  it('appends multiple messages', () => {
    appendToConversation(makeMessage('alice@99990000', 'First', 1700000000000, [BOB_KEY]), TEST_FILE, DIRECTORY);
    appendToConversation(makeMessage('bob@ffff1234', 'Second', 1700000001000, [ALICE_KEY]), TEST_FILE, DIRECTORY);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('**FROM:** alice@99990000');
    expect(content).toContain('**FROM:** bob@ffff1234');
  });

  it('creates parent directory if it does not exist', () => {
    const deepPath = join(TEST_DIR, 'subdir', 'CONVERSATION.md');
    const msg = makeMessage('alice@99990000', 'Hello');
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
    writeFileSync(TEST_FILE,
      '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234 Hello\n' +
      '[2023-11-14T22:13:21.000Z] **FROM:** bob@ffff1234 **TO:** alice@99990000 Hi\n'
    );
    const result = loadConversation(TEST_FILE, DIRECTORY);
    expect(result).toHaveLength(2);
    expect(result[0].from).toBe('alice@99990000');
    expect(result[0].to).toEqual([BOB_KEY]);
    expect(result[1].from).toBe('bob@ffff1234');
    expect(result[1].to).toEqual([ALICE_KEY]);
  });

  it('skips invalid lines without failing', () => {
    writeFileSync(TEST_FILE,
      '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234 Hello\n' +
      'invalid line\n' +
      '[2023-11-14T22:13:21.000Z] **FROM:** bob@ffff1234 **TO:** alice@99990000 Hi\n'
    );
    const result = loadConversation(TEST_FILE, DIRECTORY);
    expect(result).toHaveLength(2);
  });

  it('skips old-format lines', () => {
    writeFileSync(TEST_FILE,
      '[2023-11-14T22:13:20.000Z] [Alice] old format\n' +
      '[2023-11-14T22:13:21.000Z] **FROM:** bob@ffff1234 **TO:** alice@99990000 new format\n'
    );
    const result = loadConversation(TEST_FILE, DIRECTORY);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('bob@ffff1234');
  });

  it('roundtrips through append and load', () => {
    const messages: Message[] = [
      makeMessage('alice@99990000', 'Hello', 1700000000000, [BOB_KEY]),
      makeMessage('bob@ffff1234', 'Hi there', 1700000001000, [ALICE_KEY]),
    ];
    messages.forEach(m => appendToConversation(m, TEST_FILE, DIRECTORY));
    const loaded = loadConversation(TEST_FILE, DIRECTORY);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].from).toBe('alice@99990000');
    expect(loaded[0].text).toBe('Hello');
    expect(loaded[0].to).toEqual([BOB_KEY]);
    expect(loaded[1].from).toBe('bob@ffff1234');
    expect(loaded[1].text).toBe('Hi there');
    expect(loaded[1].to).toEqual([ALICE_KEY]);
  });

  it('returns only the most recent messages within MAX_CONVERSATION_BYTES', () => {
    for (let i = 0; i < 200; i++) {
      appendToConversation(makeMessage('User', `message ${i}`, 1700000000000 + i * 1000), TEST_FILE);
    }
    const loaded = loadConversation(TEST_FILE);
    const serialized = loaded.map(m => formatMessageLine(m)).join('\n') + '\n';
    expect(Buffer.byteLength(serialized, 'utf-8')).toBeLessThanOrEqual(MAX_CONVERSATION_BYTES);
    expect(loaded[loaded.length - 1].text).toBe('message 199');
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
