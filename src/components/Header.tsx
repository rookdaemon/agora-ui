import React from 'react';
import { Box, Text } from 'ink';
import type { ConnectionStatus } from '../types.js';

interface HeaderProps {
  status: ConnectionStatus;
  username: string;
  publicKey: string;
  onlinePeers: string[];
}

export function Header({ status, username, publicKey, onlinePeers }: HeaderProps): JSX.Element {
  const statusColor = status === 'connected' ? 'green' : 
                      status === 'connecting' ? 'yellow' : 'red';
  const statusText = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box>
        <Text bold color="cyan">Agora Chat</Text>
        <Text> - </Text>
        <Text color={statusColor}>{statusText}</Text>
        <Text> as: </Text>
        <Text bold>{username}</Text>
      </Box>
      <Box>
        <Text>Online: </Text>
        {onlinePeers.length > 0 ? (
          onlinePeers.map((name, i) => (
            <Text key={name}>
              {i > 0 ? ', ' : ''}
              <Text color="green">[{i + 1}] {name}</Text>
            </Text>
          ))
        ) : (
          <Text dimColor>No peers online</Text>
        )}
      </Box>
    </Box>
  );
}
