import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgoraConfig } from './types.js';

export function loadConfig(configPath?: string): AgoraConfig {
  const path = configPath || join(homedir(), '.config', 'agora', 'config.json');
  
  if (!existsSync(path)) {
    throw new Error(`Config file not found at ${path}. Run 'npx @rookdaemon/agora init' first.`);
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const config = JSON.parse(content) as AgoraConfig;

    if (!config.identity || !config.identity.publicKey) {
      throw new Error('Invalid config: missing identity.publicKey');
    }

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${path}`);
    }
    throw error;
  }
}

export function getRelayUrl(config: AgoraConfig, cliRelay?: string): string {
  if (cliRelay) {
    return cliRelay;
  }
  if (config.relay?.url) {
    return config.relay.url;
  }
  return 'wss://agora-relay.lbsa71.net';
}
