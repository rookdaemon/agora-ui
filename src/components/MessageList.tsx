import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../types.js';

interface MessageListProps {
  messages: Message[];
  myPublicKey: string;
  myDisplayName: string;
}

export function MessageList({ messages, myPublicKey, myDisplayName }: MessageListProps): JSX.Element {
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
      {messages.length === 0 ? (
        <Text dimColor>No messages yet. Type a message and press Enter to send.</Text>
      ) : (
        messages.map((msg, idx) => {
          // Check if message is from us by comparing display name or publicKey
          const isFromMe = msg.from === myDisplayName || msg.from === myPublicKey;
          return (
            <Box key={idx}>
              <Text dimColor>[{formatTime(msg.timestamp)}] </Text>
              <Text bold color={isFromMe ? 'cyan' : 'green'}>
                {formatSender(msg.from)}:
              </Text>
              <Text> {msg.text}</Text>
              {msg.isDM && <Text dimColor> (DM)</Text>}
            </Box>
          );
        })
      )}
    </Box>
  );
}
