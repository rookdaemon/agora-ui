#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { loadConfig, getRelayUrl } from './config.js';
import { resolveBroadcastName, formatDisplayName, shortKey } from '@rookdaemon/agora';
import { loadEnv } from './env.js';
import { getConversationPath } from './conversation.js';
import { getSentPath } from './sent.js';

function parseArgs(): { relay?: string; config?: string; name?: string; storageDir?: string } {
  const args = process.argv.slice(2);
  const result: { relay?: string; config?: string; name?: string; storageDir?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--relay' && args[i + 1]) {
      result.relay = args[i + 1];
      i++;
    } else if (args[i] === '--config' && args[i + 1]) {
      result.config = args[i + 1];
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      result.name = args[i + 1];
      i++;
    } else if (args[i] === '--storage-dir' && args[i + 1]) {
      result.storageDir = args[i + 1];
      i++;
    }
  }

  return result;
}

function main() {
  try {
    const cliArgs = parseArgs();

    // Load .env from CWD; CLI flags take precedence over .env values
    const env = loadEnv();

    // Priority: CLI > .env > default
    const configPath = cliArgs.config ?? env.configPath;
    const cliRelay = cliArgs.relay ?? env.relayUrl;
    const cliName = cliArgs.name ?? env.name;
    const storageDir = cliArgs.storageDir ?? env.storageDir;

    const config = loadConfig(configPath);
    const relayUrl = getRelayUrl(config, cliRelay);
    
    // Resolve broadcast name using priority: CLI --name, .env AGORA_UI_NAME, config.relay.name, config.identity.name
    let broadcastName = resolveBroadcastName(config as Parameters<typeof resolveBroadcastName>[0], cliName);
    // Never use the short key (id) as the relay display name
    if (broadcastName && broadcastName === shortKey(config.identity.publicKey)) {
      broadcastName = undefined;
    }
    // Format username for display: "name (...3f8c2247)" or "...3f8c2247"
    const username = formatDisplayName(broadcastName, config.identity.publicKey);

    // Resolve conversation file path from storage dir (CLI > .env > default agora config dir)
    const conversationPath = getConversationPath(storageDir);
    const sentPath = getSentPath(storageDir);

    render(
      React.createElement(App, {
        relayUrl,
        publicKey: config.identity.publicKey,
        privateKey: config.identity.privateKey,
        username,
        broadcastName,
        configPeers: config.peers,
        conversationPath,
        sentPath,
      })
    );
  } catch (error) {
    console.error('Error starting Agora UI:');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}

main();
