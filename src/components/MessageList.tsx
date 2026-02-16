import React from 'react';
import { Box, Text } from 'ink';
import { shortKey } from '@rookdaemon/agora';
import type { Message } from '../types.js';

interface MessageListProps {
  messages: Message[];
  myPublicKey: string;
}

export function MessageList({ messages, myPublicKey }: MessageListProps): JSX.Element {
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatSender = (from: string): string => {
    if (from === myPublicKey) {
      return 'You';
    }
    // Use shortKey for display (last 8 chars + "...")
    return shortKey(from);
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} minHeight={10}>
      {messages.length === 0 ? (
        <Text dimColor>No messages yet. Type a message and press Enter to send.</Text>
      ) : (
        messages.map((msg, idx) => (
          <Box key={idx}>
            <Text dimColor>[{formatTime(msg.timestamp)}] </Text>
            <Text bold color={msg.from === myPublicKey ? 'cyan' : 'green'}>
              {formatSender(msg.from)}:
            </Text>
            <Text> {msg.text}</Text>
            {msg.isDM && <Text dimColor> (DM)</Text>}
          </Box>
        ))
      )}
    </Box>
  );
}
