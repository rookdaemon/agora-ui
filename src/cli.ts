#!/usr/bin/env node
import { startWebServer } from './server.js';
import { loadConfig, getRelayUrl } from './config.js';
import { resolveBroadcastName, formatDisplayName, shortKey } from '@rookdaemon/agora';
import { getIgnoredPeersPath } from '@rookdaemon/agora';
import { loadEnv } from './env.js';
import { getConversationPath } from './conversation.js';
import { getSentPath } from './sent.js';
import type { SecurityOptions } from './types.js';

interface CliArgs extends SecurityOptions {
  relay?: string;
  config?: string;
  name?: string;
  storageDir?: string;
  port?: number;
}

function parseBooleanArg(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {};

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
    } else if (args[i] === '--port' && args[i + 1]) {
      const p = parseInt(args[i + 1], 10);
      if (isNaN(p) || p < 1 || p > 65535) {
        console.error('Invalid port: ' + args[i + 1] + ' (must be 1–65535)');
        process.exit(1);
      }
      result.port = p;
      i++;
    } else if (args[i] === '--rate-limit-enabled' && args[i + 1]) {
      result.rateLimitEnabled = parseBooleanArg(args[i + 1]);
      i++;
    } else if (args[i] === '--rate-limit-max-messages' && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed) && parsed > 0) result.rateLimitMaxMessages = parsed;
      i++;
    } else if (args[i] === '--rate-limit-window-ms' && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed) && parsed > 0) result.rateLimitWindowMs = parsed;
      i++;
    } else if (args[i] === '--dedup-enabled' && args[i + 1]) {
      result.envelopeDedupEnabled = parseBooleanArg(args[i + 1]);
      i++;
    } else if (args[i] === '--dedup-max-ids' && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed) && parsed > 0) result.envelopeDedupMaxIds = parsed;
      i++;
    } else if (args[i] === '--content-dedup-enabled' && args[i + 1]) {
      result.contentDedupEnabled = parseBooleanArg(args[i + 1]);
      i++;
    } else if (args[i] === '--content-dedup-window-ms' && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed) && parsed > 0) result.contentDedupWindowMs = parsed;
      i++;
    } else if (args[i] === '--ignore-peers' && args[i + 1]) {
      result.ignoredPeers = args[i + 1].split(',').map((peer) => peer.trim()).filter(Boolean);
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
    const ignoredPath = getIgnoredPeersPath(storageDir);

    const securityOptions: SecurityOptions = {
      rateLimitEnabled: cliArgs.rateLimitEnabled ?? env.rateLimitEnabled,
      rateLimitMaxMessages: cliArgs.rateLimitMaxMessages ?? env.rateLimitMaxMessages,
      rateLimitWindowMs: cliArgs.rateLimitWindowMs ?? env.rateLimitWindowMs,
      envelopeDedupEnabled: cliArgs.envelopeDedupEnabled ?? env.envelopeDedupEnabled,
      envelopeDedupMaxIds: cliArgs.envelopeDedupMaxIds ?? env.envelopeDedupMaxIds,
      contentDedupEnabled: cliArgs.contentDedupEnabled ?? env.contentDedupEnabled,
      contentDedupWindowMs: cliArgs.contentDedupWindowMs ?? env.contentDedupWindowMs,
      ignoredPeers: [...new Set([...(env.ignoredPeers ?? []), ...(cliArgs.ignoredPeers ?? [])])],
    };

    startWebServer({
      relayUrl,
      publicKey: config.identity.publicKey,
      privateKey: config.identity.privateKey,
      username,
      broadcastName,
      configPeers: config.peers,
      conversationPath,
      sentPath,
      ignoredPath,
      port: cliArgs.port,
      security: securityOptions,
    });
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
