#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { loadConfig, getRelayUrl } from './config.js';
import { loadAgoraConfig, resolveBroadcastName, formatDisplayName, shortKey } from '@rookdaemon/agora';

function parseArgs(): { relay?: string; config?: string; name?: string } {
  const args = process.argv.slice(2);
  const result: { relay?: string; config?: string; name?: string } = {};

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
    }
  }

  return result;
}

function main() {
  try {
    const { relay: cliRelay, config: configPath, name: cliName } = parseArgs();
    const config = loadConfig(configPath);
    const relayUrl = getRelayUrl(config, cliRelay);
    
    // Resolve broadcast name using priority: CLI --name, config.relay.name, config.identity.name
    // Load full config to get identity.name and relay.name if available
    const fullConfig = loadAgoraConfig(configPath);
    let broadcastName = resolveBroadcastName(fullConfig, cliName);
    // Never use the short key (id) as the relay display name
    if (broadcastName && broadcastName === shortKey(config.identity.publicKey)) {
      broadcastName = undefined;
    }
    // Format username for display: "name (...3f8c2247)" or "...3f8c2247"
    const username = formatDisplayName(broadcastName, config.identity.publicKey);

    render(
      React.createElement(App, {
        relayUrl,
        publicKey: config.identity.publicKey,
        privateKey: config.identity.privateKey,
        username,
        broadcastName,
        configPeers: config.peers,
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
