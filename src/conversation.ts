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
 * Trims lines from the front, removing 2 at a time (even-message boundary),
 * until the total byte size of the joined content fits within maxBytes.
 */
export function trimToByteLimit(lines: string[], maxBytes: number): string[] {
  let result = [...lines];
  while (result.length > 0) {
    const size = Buffer.byteLength(result.join('\n') + '\n', 'utf-8');
    if (size <= maxBytes) break;
    // Remove 2 lines at a time (even-message cut)
    const removeCount = Math.min(2, result.length);
    result = result.slice(removeCount);
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
