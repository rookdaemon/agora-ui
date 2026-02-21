import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { parseEnvContent, expandHome, loadEnv } from '../env.js';

const TEST_DIR = join(tmpdir(), 'agora-ui-env-test');
const TEST_ENV = join(TEST_DIR, '.env');

describe('parseEnvContent', () => {
  it('parses simple key=value pairs', () => {
    const result = parseEnvContent('FOO=bar\nBAZ=qux\n');
    expect(result['FOO']).toBe('bar');
    expect(result['BAZ']).toBe('qux');
  });

  it('ignores blank lines and comments', () => {
    const result = parseEnvContent('# comment\n\nFOO=bar\n');
    expect(Object.keys(result)).toEqual(['FOO']);
    expect(result['FOO']).toBe('bar');
  });

  it('strips double quotes from values', () => {
    const result = parseEnvContent('FOO="hello world"\n');
    expect(result['FOO']).toBe('hello world');
  });

  it('strips single quotes from values', () => {
    const result = parseEnvContent("FOO='hello world'\n");
    expect(result['FOO']).toBe('hello world');
  });

  it('handles values containing = characters', () => {
    const result = parseEnvContent('FOO=a=b=c\n');
    expect(result['FOO']).toBe('a=b=c');
  });

  it('handles missing value (empty after =)', () => {
    const result = parseEnvContent('FOO=\n');
    expect(result['FOO']).toBe('');
  });

  it('ignores lines without =', () => {
    const result = parseEnvContent('NOEQUALS\nFOO=bar\n');
    expect(Object.keys(result)).toEqual(['FOO']);
  });
});

describe('expandHome', () => {
  it('expands ~/ prefix to home directory', () => {
    const result = expandHome('~/.agora-ui');
    expect(result).toBe(join(homedir(), '.agora-ui'));
  });

  it('expands bare ~ to home directory', () => {
    const result = expandHome('~');
    expect(result).toBe(homedir());
  });

  it('does not modify paths that do not start with ~', () => {
    expect(expandHome('/absolute/path')).toBe('/absolute/path');
    expect(expandHome('relative/path')).toBe('relative/path');
  });
});

describe('loadEnv', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('returns empty object when file does not exist', () => {
    const result = loadEnv('/nonexistent/.env');
    expect(result).toEqual({});
  });

  it('loads AGORA_UI_STORAGE_DIR', () => {
    writeFileSync(TEST_ENV, 'AGORA_UI_STORAGE_DIR=/tmp/test-storage\n');
    const result = loadEnv(TEST_ENV);
    expect(result.storageDir).toBe('/tmp/test-storage');
  });

  it('loads AGORA_UI_RELAY_URL', () => {
    writeFileSync(TEST_ENV, 'AGORA_UI_RELAY_URL=wss://relay.example.com\n');
    const result = loadEnv(TEST_ENV);
    expect(result.relayUrl).toBe('wss://relay.example.com');
  });

  it('loads AGORA_UI_CONFIG', () => {
    writeFileSync(TEST_ENV, 'AGORA_UI_CONFIG=/tmp/config.json\n');
    const result = loadEnv(TEST_ENV);
    expect(result.configPath).toBe('/tmp/config.json');
  });

  it('loads AGORA_UI_NAME', () => {
    writeFileSync(TEST_ENV, 'AGORA_UI_NAME=my-agent\n');
    const result = loadEnv(TEST_ENV);
    expect(result.name).toBe('my-agent');
  });

  it('expands ~ in AGORA_UI_STORAGE_DIR', () => {
    writeFileSync(TEST_ENV, 'AGORA_UI_STORAGE_DIR=~/.agora-ui\n');
    const result = loadEnv(TEST_ENV);
    expect(result.storageDir).toBe(join(homedir(), '.agora-ui'));
  });

  it('expands ~ in AGORA_UI_CONFIG', () => {
    writeFileSync(TEST_ENV, 'AGORA_UI_CONFIG=~/.config/agora/config.json\n');
    const result = loadEnv(TEST_ENV);
    expect(result.configPath).toBe(join(homedir(), '.config/agora/config.json'));
  });

  it('ignores unknown variables', () => {
    writeFileSync(TEST_ENV, 'UNKNOWN_VAR=foo\nAGORA_UI_NAME=bar\n');
    const result = loadEnv(TEST_ENV);
    expect(result.name).toBe('bar');
    expect(Object.keys(result)).toEqual(['name']);
  });

  it('loads all variables together', () => {
    writeFileSync(TEST_ENV, [
      'AGORA_UI_STORAGE_DIR=/tmp/storage',
      'AGORA_UI_RELAY_URL=wss://relay.test',
      'AGORA_UI_CONFIG=/tmp/config.json',
      'AGORA_UI_NAME=test-agent',
    ].join('\n') + '\n');
    const result = loadEnv(TEST_ENV);
    expect(result.storageDir).toBe('/tmp/storage');
    expect(result.relayUrl).toBe('wss://relay.test');
    expect(result.configPath).toBe('/tmp/config.json');
    expect(result.name).toBe('test-agent');
  });
});
