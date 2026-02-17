import React from 'react';
import { Box, Text } from 'ink';

interface PeerListProps {
  peers: Map<string, string>;
}

export function PeerList({ peers }: PeerListProps): JSX.Element {
  const peerArray = Array.from(peers.entries());

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>Online Peers:</Text>
      {peerArray.length > 0 ? (
        peerArray.map(([pubkey, displayName]) => (
          <Box key={pubkey}>
            <Text color="green">• </Text>
            <Text bold>{displayName}</Text>
          </Box>
        ))
      ) : (
        <Text dimColor>No peers online</Text>
      )}
    </Box>
  );
}
