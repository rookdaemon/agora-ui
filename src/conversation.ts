import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getDefaultConfigPath, formatConversationLine, parseConversationLine, shorten, expand } from '@rookdaemon/agora';
import type { PeerReferenceDirectory } from '@rookdaemon/agora';
import type { Message } from './types.js';

export const MAX_CONVERSATION_BYTES = 4096;
export const LOAD_MORE_PAGE_SIZE = 20;

/**
 * Returns the path to the CONVERSATION.md file.
 * Uses storageDir if provided, otherwise falls back to the agora config directory.
 */
export function getConversationPath(storageDir?: string): string {
  if (storageDir) {
    return join(storageDir, 'CONVERSATION.md');
  }
  const configPath = getDefaultConfigPath();
  return join(dirname(configPath), 'CONVERSATION.md');
}

/**
 * Formats a message as a single parsable line.
 * Format: [ISO_TIMESTAMP] **FROM:** sender **TO:** recipient1, recipient2 text
 */
export function formatMessageLine(msg: Message, directory?: PeerReferenceDirectory): string {
  return formatConversationLine({
    timestamp: msg.timestamp,
    from: msg.from,
    to: (msg.to ?? []).map(key => shorten(key, directory)),
    text: msg.text,
  });
}

/**
 * Parses a single line from CONVERSATION.md into a Message.
 * Returns null if the line doesn't match the expected format.
 */
export function parseMessageLine(line: string, directory?: PeerReferenceDirectory): Message | null {
  const entry = parseConversationLine(line);
  if (!entry) return null;
  const fromKey = directory ? expand(entry.from, directory) : undefined;
  const to = directory
    ? entry.to.map(ref => expand(ref, directory)).filter((v): v is string => Boolean(v))
    : [];
  return {
    from: entry.from,
    fromKey: fromKey || undefined,
    text: entry.text,
    timestamp: entry.timestamp,
    to: to.length > 0 ? to : undefined,
  };
}

/**
 * Returns the largest suffix of lines whose serialised byte size
 * (lines joined with '\n' plus a trailing '\n') fits within maxBytes,
 * trimmed to an even count for clean message-pair boundaries.
 *
 * O(n) — walks backwards accumulating byte counts instead of repeatedly
 * joining the entire array.
 */
export function trimToByteLimit(lines: string[], maxBytes: number): string[] {
  // Each line contributes byteLength(line) + 1 byte for the '\n' separator/terminator.
  let totalBytes = 0;
  let startIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + 1;
    if (totalBytes + lineBytes > maxBytes) break;
    totalBytes += lineBytes;
    startIdx = i;
  }
  const result = lines.slice(startIdx);
  // Trim to an even count only when trimming actually occurred (even-message boundary).
  if (startIdx > 0 && result.length % 2 !== 0) {
    return result.slice(1);
  }
  return result;
}

/**
 * Appends a message to the CONVERSATION.md file.
 * Full history is retained on disk — no truncation.
 */
export function appendToConversation(msg: Message, filePath?: string, directory?: PeerReferenceDirectory): void {
  const path = filePath ?? getConversationPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const line = formatMessageLine(msg, directory);

  // Append-only — no read/rewrite needed
  appendFileSync(path, line + '\n', 'utf-8');
}

/**
 * Loads messages from CONVERSATION.md, returning only the most recent
 * messages that fit within MAX_CONVERSATION_BYTES (trimmed at even-message
 * boundaries). Full history is preserved on disk.
 *
 * Returns `{ messages, hasMore }` where `hasMore` is true when the file
 * contains older messages that were not loaded.
 */
export function loadConversation(filePath?: string, directory?: PeerReferenceDirectory): { messages: Message[]; hasMore: boolean } {
  const path = filePath ?? getConversationPath();

  if (!existsSync(path)) return { messages: [], hasMore: false };

  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter(l => l.length > 0);
  const trimmed = trimToByteLimit(lines, MAX_CONVERSATION_BYTES);
  const messages = trimmed.map(line => parseMessageLine(line, directory)).filter((m): m is Message => m !== null);

  return { messages, hasMore: lines.length > trimmed.length };
}

/**
 * Loads older messages before a given timestamp.
 * Returns up to maxMessages older messages, useful for pagination.
 */
export function loadOlderMessages(beforeTimestamp: number, maxMessages: number, filePath?: string, directory?: PeerReferenceDirectory): Message[] {
  const path = filePath ?? getConversationPath();

  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter(l => l.length > 0);

  // Parse all messages and filter to those before the timestamp
  const allMessages = lines.map(line => parseMessageLine(line, directory)).filter((m): m is Message => m !== null);
  const olderMessages = allMessages.filter(msg => msg.timestamp < beforeTimestamp);

  // Return the most recent maxMessages from the filtered set
  return olderMessages.slice(-maxMessages);
}
