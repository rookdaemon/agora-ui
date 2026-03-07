import { getDefaultConfigPath } from '@rookdaemon/agora';
import type { AgoraConfig as AgoraConfigLoaded } from '@rookdaemon/agora';
import { readFileSync, existsSync } from 'fs';

/** Config shape used by the UI (identity + optional relay URL + peers). */
export type AgoraConfig = Pick<AgoraConfigLoaded, 'identity' | 'peers'> & {
  relay?: { url: string };
};

/**
 * Validates the structure of a loaded config object.
 */
function validateConfig(config: unknown, configPath: string): asserts config is AgoraConfigLoaded {
  if (!config || typeof config !== 'object') {
    throw new Error(
      `Invalid config file: ${configPath}\n` +
      `Expected an object, but got ${typeof config}.\n` +
      `Please ensure your config file contains a valid JSON object.`
    );
  }

  const cfg = config as Record<string, unknown>;

  if (!cfg.identity || typeof cfg.identity !== 'object') {
    throw new Error(
      `Invalid config file: ${configPath}\n` +
      `Missing or invalid 'identity' field.\n` +
      `Expected: { identity: { publicKey: string, privateKey: string }, ... }`
    );
  }

  const identity = cfg.identity as Record<string, unknown>;

  if (!identity.publicKey || typeof identity.publicKey !== 'string') {
    throw new Error(
      `Invalid config file: ${configPath}\n` +
      `Missing or invalid 'identity.publicKey' field.\n` +
      `Expected a string value.`
    );
  }

  if (!identity.privateKey || typeof identity.privateKey !== 'string') {
    throw new Error(
      `Invalid config file: ${configPath}\n` +
      `Missing or invalid 'identity.privateKey' field.\n` +
      `Expected a string value.`
    );
  }

  if (cfg.relay !== undefined) {
    if (typeof cfg.relay !== 'object' || cfg.relay === null) {
      throw new Error(
        `Invalid config file: ${configPath}\n` +
        `Invalid 'relay' field.\n` +
        `Expected: { relay: { url: string } } or omit the relay field entirely.`
      );
    }

    const relay = cfg.relay as Record<string, unknown>;
    if (!relay.url || typeof relay.url !== 'string') {
      throw new Error(
        `Invalid config file: ${configPath}\n` +
        `Missing or invalid 'relay.url' field.\n` +
        `Expected a string value (e.g., "wss://relay.example.com").`
      );
    }
  }
}

/**
 * Sanitizes problematic characters in JSON content by replacing them with valid equivalents.
 * Returns the sanitized content.
 */
function sanitizeProblematicCharacters(content: string): string {
  return content
    // Replace non-breaking space (U+00A0) with regular space
    .replace(/\u00A0/g, ' ')
    // Remove zero-width space (U+200B)
    .replace(/\u200B/g, '')
    // Remove zero-width non-joiner (U+200C)
    .replace(/\u200C/g, '')
    // Remove zero-width joiner (U+200D)
    .replace(/\u200D/g, '')
    // Remove Byte Order Mark (U+FEFF)
    .replace(/\uFEFF/g, '');
}

/**
 * Attempts to parse JSON and provides detailed error messages.
 */
function parseJSONWithDetails(content: string, configPath: string): unknown {
  // Sanitize problematic characters before attempting to parse
  const sanitizedContent = sanitizeProblematicCharacters(content);

  try {
    return JSON.parse(sanitizedContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const match = error.message.match(/position (\d+)/);
      const position = match ? parseInt(match[1], 10) : null;

      let errorMsg = `Invalid JSON in config file: ${configPath}\n`;
      errorMsg += `JSON parse error: ${error.message}\n`;

      if (position !== null && position > 0) {
        const lines = sanitizedContent.substring(0, position).split('\n');
        const lineNumber = lines.length;
        const columnNumber = lines[lines.length - 1].length + 1;
        errorMsg += `Error at line ${lineNumber}, column ${columnNumber}\n`;

        // Show context around the error
        const allLines = sanitizedContent.split('\n');
        const startLine = Math.max(0, lineNumber - 3);
        const endLine = Math.min(allLines.length, lineNumber + 2);

        errorMsg += '\nContext:\n';
        for (let i = startLine; i < endLine; i++) {
          const prefix = i + 1 === lineNumber ? '>>> ' : '    ';
          errorMsg += `${prefix}${i + 1}: ${allLines[i]}\n`;
          if (i + 1 === lineNumber) {
            errorMsg += `${' '.repeat(prefix.length + columnNumber + String(i + 1).length + 1)}^\n`;
          }
        }
      }

      errorMsg += '\nPlease fix the JSON syntax errors in your config file.';
      throw new Error(errorMsg);
    }
    throw error;
  }
}

/**
 * Load Agora config using canonical loader from @rookdaemon/agora.
 * Provides enhanced validation and error messages.
 */
export function loadConfig(configPath?: string): AgoraConfig & { identity: { publicKey: string; privateKey: string } } {
  const path = configPath ?? getDefaultConfigPath();

  // Check if file exists first
  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\n` +
      `Please create a config file at this location with the following structure:\n` +
      `{\n` +
      `  "identity": {\n` +
      `    "publicKey": "your-public-key",\n` +
      `    "privateKey": "your-private-key"\n` +
      `  },\n` +
      `  "relay": {\n` +
      `    "url": "wss://relay.example.com"\n` +
      `  }\n` +
      `}`
    );
  }

  // Try to read and parse the file first to provide better JSON error messages
  let fileContent: string;
  try {
    fileContent = readFileSync(path, 'utf-8');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to read config file: ${path}\n` +
        `Error: ${error.message}\n` +
        `Please check file permissions and ensure the file is readable.`
      );
    }
    throw error;
  }

  // Validate JSON syntax before passing to loadAgoraConfig
  let parsedConfig: unknown;
  try {
    parsedConfig = parseJSONWithDetails(fileContent, path);
  } catch (error) {
    // Re-throw JSON parsing errors with detailed context
    throw error;
  }

  // Validate structure
  validateConfig(parsedConfig, path);

  // Use the already-parsed and validated config
  const config = parsedConfig as AgoraConfigLoaded;
  return {
    identity: config.identity,
    peers: config.peers || {},
    relay: config.relay ? { url: config.relay.url } : undefined,
  };
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
