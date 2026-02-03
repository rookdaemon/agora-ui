#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { loadConfig, getRelayUrl } from './config.js';

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
    const username = cliName || config.identity.publicKey.slice(0, 8);

    render(
      React.createElement(App, {
        relayUrl,
        publicKey: config.identity.publicKey,
        username
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
