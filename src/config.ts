import { loadAgoraConfig, getDefaultConfigPath } from '@rookdaemon/agora';
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
 * Checks for problematic characters in the content that might cause JSON parsing issues.
 */
function checkForProblematicCharacters(content: string, configPath: string): void {
  const problematicChars: Array<{ char: string; name: string; code: number }> = [];
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const code = char.charCodeAt(0);
    
    // Check for non-breaking space (U+00A0) - common issue
    if (code === 160) {
      problematicChars.push({ char, name: 'Non-breaking space (U+00A0)', code });
    }
    // Check for other problematic whitespace characters
    else if (code === 8203) { // Zero-width space
      problematicChars.push({ char, name: 'Zero-width space (U+200B)', code });
    }
    else if (code === 8204) { // Zero-width non-breaker
      problematicChars.push({ char, name: 'Zero-width non-breaker (U+200C)', code });
    }
    else if (code === 8205) { // Zero-width joiner
      problematicChars.push({ char, name: 'Zero-width joiner (U+200D)', code });
    }
    else if (code === 65279) { // BOM
      problematicChars.push({ char, name: 'Byte Order Mark (U+FEFF)', code });
    }
  }
  
  if (problematicChars.length > 0) {
    // Find the first problematic character's location
    const firstIssue = problematicChars[0];
    const firstIndex = content.indexOf(firstIssue.char);
    const lines = content.substring(0, firstIndex).split('\n');
    const lineNumber = lines.length;
    const columnNumber = lines[lines.length - 1].length + 1;
    
    let errorMsg = `Invalid characters detected in config file: ${configPath}\n`;
    errorMsg += `Found ${problematicChars.length} problematic character(s), starting at line ${lineNumber}, column ${columnNumber}\n`;
    errorMsg += `Issue: ${firstIssue.name} (char code ${firstIssue.code})\n\n`;
    errorMsg += `JSON parsers don't accept non-breaking spaces and other special whitespace characters.\n`;
    errorMsg += `These often appear when copying text from word processors or web browsers.\n\n`;
    errorMsg += `To fix this:\n`;
    errorMsg += `1. Open the config file in a text editor\n`;
    errorMsg += `2. Replace all non-breaking spaces with regular spaces\n`;
    errorMsg += `3. Or re-type the indentation using regular spaces or tabs\n`;
    errorMsg += `4. Save the file and try again\n`;
    
    // Show context
    const allLines = content.split('\n');
    const startLine = Math.max(0, lineNumber - 3);
    const endLine = Math.min(allLines.length, lineNumber + 2);
    
    errorMsg += '\nContext around the issue:\n';
    for (let i = startLine; i < endLine; i++) {
      const prefix = i + 1 === lineNumber ? '>>> ' : '    ';
      // Replace non-breaking spaces with visible markers for display
      const displayLine = allLines[i].replace(/\u00A0/g, '␣');
      errorMsg += `${prefix}${i + 1}: ${displayLine}\n`;
      if (i + 1 === lineNumber) {
        errorMsg += `${' '.repeat(prefix.length + columnNumber + String(i + 1).length + 1)}^\n`;
      }
    }
    
    throw new Error(errorMsg);
  }
}

/**
 * Attempts to parse JSON and provides detailed error messages.
 */
function parseJSONWithDetails(content: string, configPath: string): unknown {
  // First check for problematic characters before attempting to parse
  checkForProblematicCharacters(content, configPath);
  
  try {
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const match = error.message.match(/position (\d+)/);
      const position = match ? parseInt(match[1], 10) : null;
      
      let errorMsg = `Invalid JSON in config file: ${configPath}\n`;
      errorMsg += `JSON parse error: ${error.message}\n`;
      
      if (position !== null && position > 0) {
        const lines = content.substring(0, position).split('\n');
        const lineNumber = lines.length;
        const columnNumber = lines[lines.length - 1].length + 1;
        errorMsg += `Error at line ${lineNumber}, column ${columnNumber}\n`;
        
        // Check if there are non-breaking spaces near the error
        const errorLine = content.split('\n')[lineNumber - 1];
        if (errorLine && errorLine.includes('\u00A0')) {
          errorMsg += `\n⚠️  WARNING: This line contains non-breaking spaces (char code 160)!\n`;
          errorMsg += `Non-breaking spaces look like regular spaces but cause JSON parsing errors.\n`;
          errorMsg += `Replace them with regular spaces (char code 32) or tabs.\n`;
        }
        
        // Show context around the error
        const allLines = content.split('\n');
        const startLine = Math.max(0, lineNumber - 3);
        const endLine = Math.min(allLines.length, lineNumber + 2);
        
        errorMsg += '\nContext:\n';
        for (let i = startLine; i < endLine; i++) {
          const prefix = i + 1 === lineNumber ? '>>> ' : '    ';
          // Replace non-breaking spaces with visible markers for display
          const displayLine = allLines[i].replace(/\u00A0/g, '␣');
          errorMsg += `${prefix}${i + 1}: ${displayLine}\n`;
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

  // Use the canonical loader (which may do additional validation)
  try {
    const config = loadAgoraConfig(path);
    return {
      identity: config.identity,
      peers: config.peers,
      relay: config.relay ? { url: config.relay.url } : undefined,
    };
  } catch (error) {
    // If loadAgoraConfig fails, provide context
    if (error instanceof Error) {
      // Check if it's a JSON error we already handled
      if (error.message.includes('Invalid JSON')) {
        // We already provided detailed JSON error, but loadAgoraConfig might have different validation
        throw new Error(
          `Config validation failed: ${path}\n` +
          `${error.message}\n` +
          `The JSON syntax appears valid, but the config structure may be incorrect.\n` +
          `Please ensure your config file matches the expected structure.`
        );
      }
      throw error;
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
