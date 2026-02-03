import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { Input } from './components/Input.js';
import { RelayClient } from './relay.js';
import type { Message, ConnectionStatus } from './types.js';

interface AppProps {
  relayUrl: string;
  publicKey: string;
  username: string;
}

export function App({ relayUrl, publicKey, username }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [peers, setPeers] = useState<Map<string, string>>(new Map());
  const [relay, setRelay] = useState<RelayClient | null>(null);

  useEffect(() => {
    const client = new RelayClient(relayUrl, publicKey);

    client.onStatusChange = (newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'connected') {
        addSystemMessage('Connected to relay');
      } else if (newStatus === 'disconnected') {
        addSystemMessage('Disconnected from relay');
      }
    };

    client.onMessage = (from, envelope) => {
      setMessages((prev) => [
        ...prev,
        {
          from,
          text: envelope.text,
          timestamp: envelope.timestamp,
          isDM: false
        }
      ]);
    };

    client.onPeers = (peerKeys) => {
      // Initial peers list from registration
      setPeers((prev) => {
        const newPeers = new Map(prev);
        for (const peerKey of peerKeys) {
          newPeers.set(peerKey, peerKey.slice(0, 8));
        }
        return newPeers;
      });
      if (peerKeys.length > 0) {
        addSystemMessage(`${peerKeys.length} peer(s) online`);
      }
    };

    client.onPeerOnline = (peerKey) => {
      setPeers((prev) => {
        const newPeers = new Map(prev);
        newPeers.set(peerKey, peerKey.slice(0, 8));
        return newPeers;
      });
      addSystemMessage(`Peer ${peerKey.slice(0, 8)} came online`);
    };

    client.onPeerOffline = (peerKey) => {
      setPeers((prev) => {
        const newPeers = new Map(prev);
        newPeers.delete(peerKey);
        return newPeers;
      });
      addSystemMessage(`Peer ${peerKey.slice(0, 8)} went offline`);
    };

    client.onError = (error) => {
      addSystemMessage(`Error: ${error}`);
    };

    client.connect();
    setRelay(client);

    return () => {
      client.disconnect();
    };
  }, [relayUrl, publicKey]);

  const addSystemMessage = (text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        from: 'system',
        text,
        timestamp: Date.now(),
        isDM: false
      }
    ]);
  };

  const handleCommand = (command: string): boolean => {
    const cmd = command.toLowerCase();

    if (cmd === '/quit' || cmd === '/exit') {
      relay?.disconnect();
      exit();
      return true;
    }

    if (cmd === '/clear') {
      setMessages([]);
      return true;
    }

    if (cmd === '/help') {
      addSystemMessage('Commands:');
      addSystemMessage('  @peer message - Send DM to specific peer');
      addSystemMessage('  /peers - List online peers with full pubkeys');
      addSystemMessage('  /clear - Clear message history');
      addSystemMessage('  /help - Show this help');
      addSystemMessage('  /quit - Exit the chat');
      return true;
    }

    if (cmd === '/peers') {
      if (peers.size === 0) {
        addSystemMessage('No peers online');
      } else {
        addSystemMessage('Online peers:');
        peers.forEach((name, pubkey) => {
          addSystemMessage(`  ${name}: ${pubkey}`);
        });
      }
      return true;
    }

    return false;
  };

  const handleSubmit = (value: string) => {
    if (!value.trim()) {
      setInputValue('');
      return;
    }

    // Check if it's a command
    if (value.startsWith('/')) {
      handleCommand(value);
      setInputValue('');
      return;
    }

    // Check for DM (@peer message)
    const dmMatch = value.match(/^@(\S+)\s+(.+)$/);
    if (dmMatch) {
      const [, peerName, text] = dmMatch;
      // Find peer by name prefix
      const peerEntry = Array.from(peers.entries()).find(([key, name]) => 
        name.startsWith(peerName) || key.startsWith(peerName)
      );

      if (peerEntry) {
        const [peerKey] = peerEntry;
        relay?.sendMessage(peerKey, text);
        setMessages((prev) => [
          ...prev,
          {
            from: publicKey,
            text: `@${peerName}: ${text}`,
            timestamp: Date.now(),
            isDM: true
          }
        ]);
      } else {
        addSystemMessage(`Peer '${peerName}' not found`);
      }
      setInputValue('');
      return;
    }

    // Broadcast or single peer
    if (peers.size === 0) {
      addSystemMessage('No peers online to send message to');
    } else if (peers.size === 1) {
      // Send to the only peer
      const [peerKey] = Array.from(peers.keys());
      relay?.sendMessage(peerKey, value);
      setMessages((prev) => [
        ...prev,
        {
          from: publicKey,
          text: value,
          timestamp: Date.now(),
          isDM: false
        }
      ]);
    } else {
      // Broadcast to all peers
      peers.forEach((_, peerKey) => {
        relay?.sendMessage(peerKey, value);
      });
      setMessages((prev) => [
        ...prev,
        {
          from: publicKey,
          text: value,
          timestamp: Date.now(),
          isDM: false
        }
      ]);
    }

    setInputValue('');
  };

  const onlinePeerNames = Array.from(peers.values());

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        status={status}
        username={username}
        publicKey={publicKey}
        onlinePeers={onlinePeerNames}
      />
      <Box marginY={1}>
        <MessageList messages={messages} myPublicKey={publicKey} />
      </Box>
      <Input
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
      />
      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C or type /quit to exit</Text>
      </Box>
    </Box>
  );
}
