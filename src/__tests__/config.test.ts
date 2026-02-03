import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { loadConfig, getRelayUrl } from '../config.js';
import type { AgoraConfig } from '../types.js';

const TEST_DIR = '/tmp/agora-ui-test';
const TEST_CONFIG_PATH = join(TEST_DIR, 'config.json');

describe('Config Loading', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should load valid config', () => {
    const config: AgoraConfig = {
      identity: {
        publicKey: '302a300506032b657003210012345678',
        privateKey: 'private123'
      },
      relay: {
        url: 'wss://test-relay.example.com'
      }
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
    const loaded = loadConfig(TEST_CONFIG_PATH);

    expect(loaded.identity.publicKey).toBe(config.identity.publicKey);
    expect(loaded.identity.privateKey).toBe(config.identity.privateKey);
    expect(loaded.relay?.url).toBe(config.relay?.url);
  });

  it('should throw error for missing config file', () => {
    expect(() => loadConfig('/nonexistent/config.json')).toThrow();
  });

  it('should throw error for invalid JSON', () => {
    writeFileSync(TEST_CONFIG_PATH, 'invalid json{');
    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow('Invalid JSON');
  });

  it('should throw error for missing identity', () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow('Invalid config');
  });
});

describe('Relay URL Resolution', () => {
  it('should use CLI relay if provided', () => {
    const config: AgoraConfig = {
      identity: { publicKey: '123', privateKey: '456' },
      relay: { url: 'wss://config-relay.com' }
    };
    const url = getRelayUrl(config, 'wss://cli-relay.com');
    expect(url).toBe('wss://cli-relay.com');
  });

  it('should use config relay if no CLI relay', () => {
    const config: AgoraConfig = {
      identity: { publicKey: '123', privateKey: '456' },
      relay: { url: 'wss://config-relay.com' }
    };
    const url = getRelayUrl(config);
    expect(url).toBe('wss://config-relay.com');
  });

  it('should use default relay if none provided', () => {
    const config: AgoraConfig = {
      identity: { publicKey: '123', privateKey: '456' }
    };
    const url = getRelayUrl(config);
    expect(url).toBe('wss://agora-relay.lbsa71.net');
  });
});
