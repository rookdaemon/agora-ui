import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getDefaultConfigPath } from '@rookdaemon/agora';
import type { Message } from './types.js';

export const MAX_CONVERSATION_LINES = 200;

/**
 * Returns the path to the CONVERSATION.md file.
 * Located in the same directory as the agora config file.
 */
export function getConversationPath(): string {
  const configPath = getDefaultConfigPath();
  return join(dirname(configPath), 'CONVERSATION.md');
}

/**
 * Formats a message as a single parsable line.
 * Format: [ISO_TIMESTAMP] [FROM] TEXT
 * DM messages: [ISO_TIMESTAMP] [FROM] [DM] TEXT
 */
export function formatMessageLine(msg: Message): string {
  const ts = new Date(msg.timestamp).toISOString();
  // Replace newlines in text to ensure single-line format
  const safeText = msg.text.replace(/\r?\n/g, ' ');
  const dmPrefix = msg.isDM ? '[DM] ' : '';
  return `[${ts}] [${msg.from}] ${dmPrefix}${safeText}`;
}

/**
 * Parses a single line from CONVERSATION.md into a Message.
 * Returns null if the line cannot be parsed.
 */
export function parseMessageLine(line: string): Message | null {
  const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.*)$/);
  if (!match) return null;
  const [, ts, from, rest] = match;
  const timestamp = new Date(ts).getTime();
  if (isNaN(timestamp)) return null;
  const isDM = rest.startsWith('[DM] ');
  const text = isDM ? rest.slice(5) : rest;
  return { from, text, timestamp, isDM };
}

/**
 * Appends a message to the CONVERSATION.md file.
 * Enforces a maximum of MAX_CONVERSATION_LINES lines.
 */
export function appendToConversation(msg: Message, filePath?: string): void {
  const path = filePath ?? getConversationPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let lines: string[] = [];
  if (existsSync(path)) {
    lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.length > 0);
  }

  lines.push(formatMessageLine(msg));

  if (lines.length > MAX_CONVERSATION_LINES) {
    lines = lines.slice(lines.length - MAX_CONVERSATION_LINES);
  }

  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Loads and parses all messages from CONVERSATION.md.
 * Returns an empty array if the file does not exist or cannot be parsed.
 */
export function loadConversation(filePath?: string): Message[] {
  const path = filePath ?? getConversationPath();

  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter(l => l.length > 0);

  return lines.map(parseMessageLine).filter((m): m is Message => m !== null);
}
