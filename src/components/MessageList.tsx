import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { Message } from '../types.js';

interface MessageListProps {
  messages: Message[];
  myPublicKey: string;
  myDisplayName: string;
}

export function MessageList({ messages, myPublicKey, myDisplayName }: MessageListProps): JSX.Element {
  const { stdout } = useStdout();
  // Reserve rows for header (~3), border (~2), input (~3), footer (~2)
  const reservedRows = 10;
  const terminalHeight = stdout?.rows ?? 24;
  const maxVisible = Math.max(1, terminalHeight - reservedRows);
  const visibleMessages = messages.slice(-maxVisible);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatSender = (from: string): string => {
    // Messages already contain resolved display names from App.tsx
    // Check if it's from us by comparing display names
    if (from === myDisplayName || from === myPublicKey) {
      return 'You';
    }
    // Display name is already formatted (name (...3f8c2247) or ...3f8c2247)
    return from;
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} minHeight={10}>
      {visibleMessages.length === 0 ? (
        <Text dimColor>No messages yet. Type a message and press Enter to send.</Text>
      ) : (
        visibleMessages.map((msg, idx) => {
          // Check if message is from us by comparing display name or publicKey
          const isSystem = msg.from === 'system';
          const isFromMe = msg.from === myDisplayName || msg.from === myPublicKey;
          return (
            <Box key={idx}>
              <Text dimColor>[{formatTime(msg.timestamp)}] </Text>
              <Text bold color={isFromMe ? 'cyan' : 'green'}>
                {formatSender(msg.from)}:
              </Text>
              <Text> {msg.text}</Text>
              {!isSystem && (msg.isDM ? <Text dimColor> (DM)</Text> : <Text dimColor> (ALL)</Text>)}
            </Box>
          );
        })
      )}
    </Box>
  );
}
