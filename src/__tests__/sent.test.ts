import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { appendToSent, loadSent, MAX_SENT_LINES } from '../sent.js';

const TEST_DIR = '/tmp/agora-ui-sent-test';
const TEST_FILE = join(TEST_DIR, 'SENT.md');

describe('appendToSent', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('creates the file if it does not exist', () => {
    appendToSent('hello world', TEST_FILE);
    expect(existsSync(TEST_FILE)).toBe(true);
  });

  it('writes the text as a single line', () => {
    appendToSent('hello world', TEST_FILE);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content.trim()).toBe('hello world');
  });

  it('replaces newlines to ensure single-line format', () => {
    appendToSent('line1\nline2', TEST_FILE);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).not.toContain('\n\n');
    expect(content).toContain('line1 line2');
  });

  it('replaces CRLF in text', () => {
    appendToSent('a\r\nb', TEST_FILE);
    const content = readFileSync(TEST_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a b');
  });

  it('appends multiple lines', () => {
    appendToSent('first', TEST_FILE);
    appendToSent('second', TEST_FILE);
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });

  it('creates parent directory if it does not exist', () => {
    const deepPath = join(TEST_DIR, 'subdir', 'SENT.md');
    appendToSent('hello', deepPath);
    expect(existsSync(deepPath)).toBe(true);
  });

  it(`trims to at most ${MAX_SENT_LINES} lines`, () => {
    const count = MAX_SENT_LINES + 10;
    for (let i = 0; i < count; i++) {
      appendToSent(`message ${i}`, TEST_FILE);
    }
    const content = readFileSync(TEST_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBe(MAX_SENT_LINES);
  }, 20000);

  it('keeps the most recent lines when trimming', () => {
    const count = MAX_SENT_LINES + 5;
    for (let i = 0; i < count; i++) {
      appendToSent(`message ${i}`, TEST_FILE);
    }
    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).not.toContain('message 0');
    expect(content).toContain(`message ${count - 1}`);
  });
});

describe('loadSent', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('returns empty array if file does not exist', () => {
    const result = loadSent(TEST_FILE);
    expect(result).toEqual([]);
  });

  it('loads lines from file', () => {
    writeFileSync(TEST_FILE, 'first\nsecond\nthird\n');
    const result = loadSent(TEST_FILE);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('first');
    expect(result[2]).toBe('third');
  });

  it('skips empty lines', () => {
    writeFileSync(TEST_FILE, 'first\n\nsecond\n');
    const result = loadSent(TEST_FILE);
    expect(result).toHaveLength(2);
  });

  it('roundtrips through append and load', () => {
    appendToSent('hello', TEST_FILE);
    appendToSent('world', TEST_FILE);
    const loaded = loadSent(TEST_FILE);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toBe('hello');
    expect(loaded[1]).toBe('world');
  });
});
