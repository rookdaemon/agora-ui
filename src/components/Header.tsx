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
  const truncatedKey = publicKey.slice(0, 8) + '...';
  
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
        <Text dimColor> ({truncatedKey})</Text>
      </Box>
      <Box>
        <Text>Online: </Text>
        {onlinePeers.length > 0 ? (
          <Text color="green">{onlinePeers.join(', ')}</Text>
        ) : (
          <Text dimColor>No peers online</Text>
        )}
      </Box>
    </Box>
  );
}
