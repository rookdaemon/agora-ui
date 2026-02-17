import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import { RelayClient, createEnvelope } from '@rookdaemon/agora';
import type { Envelope, RelayPeer } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { Input } from './components/Input.js';
import { resolveDisplayName, formatDisplayName } from './utils.js';
import type { Message, ConnectionStatus } from './types.js';

interface AppProps {
  relayUrl: string;
  publicKey: string;
  privateKey: string;
  username: string;
  broadcastName?: string;
  configPeers: Record<string, AgoraPeerConfig>;
}

function extractTextFromPayload(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload && typeof (payload as { text: unknown }).text === 'string') {
    return (payload as { text: string }).text;
  }
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload ?? '');
}

export function App({ relayUrl, publicKey, privateKey, username, broadcastName, configPeers }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [peers, setPeers] = useState<Map<string, string>>(new Map());
  const relayRef = useRef<RelayClient | null>(null);

  useEffect(() => {
    const client = new RelayClient({
      relayUrl,
      publicKey,
      privateKey,
      name: broadcastName,
    });

    client.on('connected', () => {
      setStatus('connected');
      setMessages((prev) => [...prev, { from: 'system', text: 'Connected to relay', timestamp: Date.now(), isDM: false }]);
      const online = client.getOnlinePeers();
      setPeers((prev) => {
        const next = new Map(prev);
        for (const p of online) {
          // Resolve display name using priority: config.peers[publicKey].name, peer.name
          const resolvedName = resolveDisplayName(p.publicKey, p.name, configPeers);
          const displayName = formatDisplayName(resolvedName, p.publicKey);
          next.set(p.publicKey, displayName);
        }
        return next;
      });
      if (online.length > 0) {
        setMessages((prev) => [...prev, { from: 'system', text: `${online.length} peer(s) online`, timestamp: Date.now(), isDM: false }]);
      }
    });

    client.on('disconnected', () => {
      setStatus('disconnected');
      setMessages((prev) => [...prev, { from: 'system', text: 'Disconnected from relay', timestamp: Date.now(), isDM: false }]);
    });

    client.on('message', (envelope: Envelope, from: string, fromName?: string) => {
      // Resolve display name using priority: config.peers[publicKey].name, peer.name
      const resolvedName = resolveDisplayName(from, fromName, configPeers);
      const displayName = formatDisplayName(resolvedName, from);
      const text = extractTextFromPayload(envelope.payload);
      setMessages((prev) => [
        ...prev,
        {
          from: displayName,
          text,
          timestamp: envelope.timestamp,
          isDM: false,
        },
      ]);
    });

    client.on('peer_online', (peer: RelayPeer) => {
      // Resolve display name using priority: config.peers[publicKey].name, peer.name
      const resolvedName = resolveDisplayName(peer.publicKey, peer.name, configPeers);
      const displayName = formatDisplayName(resolvedName, peer.publicKey);
      setPeers((prev) => {
        const next = new Map(prev);
        next.set(peer.publicKey, displayName);
        return next;
      });
      setMessages((prev) => [...prev, { from: 'system', text: `${displayName} came online`, timestamp: Date.now(), isDM: false }]);
    });

    client.on('peer_offline', (peer: RelayPeer) => {
      // Resolve display name using priority: config.peers[publicKey].name, peer.name
      const resolvedName = resolveDisplayName(peer.publicKey, peer.name, configPeers);
      const displayName = formatDisplayName(resolvedName, peer.publicKey);
      setPeers((prev) => {
        const next = new Map(prev);
        next.delete(peer.publicKey);
        return next;
      });
      setMessages((prev) => [...prev, { from: 'system', text: `${displayName} went offline`, timestamp: Date.now(), isDM: false }]);
    });

    client.on('error', (err: Error) => {
      setMessages((prev) => [
        ...prev,
        { from: 'system', text: `Error: ${err.message}`, timestamp: Date.now(), isDM: false },
      ]);
    });

    relayRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      relayRef.current = null;
    };
  }, [relayUrl, publicKey, privateKey, broadcastName, configPeers]);

  const addSystemMessage = (text: string) => {
    setMessages((prev) => [
      ...prev,
      { from: 'system', text, timestamp: Date.now(), isDM: false },
    ]);
  };

  const handleCommand = (command: string): boolean => {
    const cmd = command.toLowerCase();
    const relay = relayRef.current;

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

    if (value.startsWith('/')) {
      handleCommand(value);
      setInputValue('');
      return;
    }

    const relay = relayRef.current;
    if (!relay?.connected()) {
      addSystemMessage('Not connected to relay');
      setInputValue('');
      return;
    }

    const dmMatch = value.match(/^@(\S+)\s+(.+)$/);
    if (dmMatch) {
      const [, peerName, text] = dmMatch;
      const peerEntry = Array.from(peers.entries()).find(
        ([key, name]) => name.startsWith(peerName) || key.startsWith(peerName)
      );

      if (peerEntry) {
        const [peerKey] = peerEntry;
        const envelope = createEnvelope('publish', publicKey, privateKey, { text });
        relay.send(peerKey, envelope);
        const ownDisplayName = formatDisplayName(broadcastName, publicKey);
        setMessages((prev) => [
          ...prev,
          {
            from: ownDisplayName,
            text: `@${peerName}: ${text}`,
            timestamp: Date.now(),
            isDM: true,
          },
        ]);
      } else {
        addSystemMessage(`Peer '${peerName}' not found`);
      }
      setInputValue('');
      return;
    }

    if (peers.size === 0) {
      addSystemMessage('No peers online to send message to');
    } else {
      const envelope = createEnvelope('publish', publicKey, privateKey, { text: value });
      relay.broadcast(envelope);
      // Use formatted username for own messages
      const ownDisplayName = formatDisplayName(broadcastName, publicKey);
      setMessages((prev) => [
        ...prev,
        {
          from: ownDisplayName,
          text: value,
          timestamp: Date.now(),
          isDM: false,
        },
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
        <MessageList messages={messages} myPublicKey={publicKey} myDisplayName={formatDisplayName(broadcastName, publicKey)} />
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
