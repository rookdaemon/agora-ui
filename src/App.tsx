import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { RelayClient, createEnvelope } from '@rookdaemon/agora';
import type { Envelope, RelayPeer } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { Input } from './components/Input.js';
import { Tabs } from './components/Tabs.js';
import type { TabItem } from './components/Tabs.js';
import { resolveDisplayName, formatDisplayName, sanitizeText } from './utils.js';
import { appendToConversation, loadConversation, MAX_CONVERSATION_LINES } from './conversation.js';
import { appendToSent, loadSent } from './sent.js';
import type { Message, ConnectionStatus } from './types.js';

interface AppProps {
  relayUrl: string;
  publicKey: string;
  privateKey: string;
  username: string;
  broadcastName?: string;
  configPeers: Record<string, AgoraPeerConfig>;
  conversationPath?: string;
  sentPath?: string;
}

function extractTextFromPayload(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload && typeof (payload as { text: unknown }).text === 'string') {
    return sanitizeText((payload as { text: string }).text);
  }
  if (typeof payload === 'string') return sanitizeText(payload);
  return sanitizeText(JSON.stringify(payload ?? ''));
}

export function App({ relayUrl, publicKey, privateKey, username, broadcastName, configPeers, conversationPath, sentPath }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [systemMessages, setSystemMessages] = useState<Message[]>([]);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [peers, setPeers] = useState<Map<string, string>>(new Map());
  const [sentHistory, setSentHistory] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  // peerKey -> displayName for peers with DM history
  const [dmPeers, setDmPeers] = useState<Map<string, string>>(new Map());
  const relayRef = useRef<RelayClient | null>(null);

  // All messages sorted by timestamp for display
  const messages = useMemo(
    () => [...systemMessages, ...chatMessages].sort((a, b) => a.timestamp - b.timestamp),
    [systemMessages, chatMessages]
  );

  // Available tabs: "All" + one per peer with DM history
  const tabs = useMemo<TabItem[]>(() => {
    const peerTabs = Array.from(dmPeers.entries()).map(([id, label]) => ({ id, label }));
    return [{ id: 'all', label: 'All' }, ...peerTabs];
  }, [dmPeers]);

  // Messages visible in the current tab
  const tabMessages = useMemo(() => {
    if (activeTab === 'all') return messages;
    // Per-peer DM tab: system messages + DMs with this specific peer
    return messages.filter(msg => msg.from === 'system' || msg.peer === activeTab);
  }, [messages, activeTab]);

  // Switch tabs with the Tab key
  useInput((_input, key) => {
    if (key.tab && tabs.length > 1) {
      const ids = tabs.map(t => t.id);
      const next = (ids.indexOf(activeTab) + 1) % ids.length;
      setActiveTab(ids[next]);
    }
  });

  // Load chat history from CONVERSATION.md on mount
  useEffect(() => {
    const loaded = loadConversation(conversationPath);
    setChatMessages(loaded);
    // Restore DM peer tabs from history (only messages where peer is known)
    const peersFromHistory = new Map<string, string>();
    for (const msg of loaded) {
      if (msg.isDM && msg.peer && !peersFromHistory.has(msg.peer)) {
        // Use the last 8 hex chars of the key as a short display label until
        // the relay resolves the real display name for this peer.
        peersFromHistory.set(msg.peer, msg.peer.slice(-8));
      }
    }
    if (peersFromHistory.size > 0) {
      setDmPeers(peersFromHistory);
    }
  }, [conversationPath]);

  // Load sent history from SENT.md on mount
  useEffect(() => {
    setSentHistory(loadSent(sentPath));
  }, [sentPath]);

  useEffect(() => {
    const client = new RelayClient({
      relayUrl,
      publicKey,
      privateKey,
      name: broadcastName,
    });

    client.on('connected', () => {
      setStatus('connected');
      setSystemMessages((prev) => [...prev, { from: 'system', text: 'Connected to relay', timestamp: Date.now(), isDM: false }]);
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
        setSystemMessages((prev) => [...prev, { from: 'system', text: `${online.length} peer(s) online`, timestamp: Date.now(), isDM: false }]);
      }
    });

    client.on('disconnected', () => {
      setStatus('disconnected');
      setSystemMessages((prev) => [...prev, { from: 'system', text: 'Disconnected from relay', timestamp: Date.now(), isDM: false }]);
    });

    client.on('message', (envelope: Envelope, from: string, fromName?: string) => {
      // Resolve display name using priority: config.peers[publicKey].name, peer.name
      const resolvedName = resolveDisplayName(from, fromName, configPeers);
      const displayName = formatDisplayName(resolvedName, from);
      const text = extractTextFromPayload(envelope.payload);
      // Detect DMs: sender included a `dm: true` marker in the payload
      const isDM = !!(
        envelope.payload &&
        typeof envelope.payload === 'object' &&
        (envelope.payload as Record<string, unknown>).dm === true
      );
      const msg: Message = {
        from: displayName,
        text,
        timestamp: envelope.timestamp,
        isDM,
        peer: isDM ? from : undefined,
      };
      if (isDM) {
        setDmPeers(prev => {
          if (prev.has(from)) return prev;
          const next = new Map(prev);
          next.set(from, displayName);
          return next;
        });
      }
      setChatMessages(prev => [...prev, msg].slice(-MAX_CONVERSATION_LINES));
      try { appendToConversation(msg, conversationPath); } catch {}
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
      setSystemMessages((prev) => [...prev, { from: 'system', text: `${displayName} came online`, timestamp: Date.now(), isDM: false }]);
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
      setSystemMessages((prev) => [...prev, { from: 'system', text: `${displayName} went offline`, timestamp: Date.now(), isDM: false }]);
    });

    client.on('error', (err: Error) => {
      setSystemMessages((prev) => [
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
    setSystemMessages((prev) => [
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
      setSystemMessages([]);
      setChatMessages([]);
      return true;
    }

    if (cmd === '/help') {
      addSystemMessage('Commands:');
      addSystemMessage('  @peer message - Send DM to specific peer');
      addSystemMessage('  /peers - List online peers with full pubkeys');
      addSystemMessage('  /clear - Clear message history');
      addSystemMessage('  /help - Show this help');
      addSystemMessage('  /quit - Exit the chat');
      addSystemMessage('  Tab - Switch between conversation tabs');
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

    // Record every non-empty submitted line to sent history
    try { appendToSent(value, sentPath); } catch {}
    setSentHistory(prev => [...prev, value]);

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

    // If we're in a peer's DM tab and the message has no explicit @peer prefix,
    // automatically send it as a DM to that peer.
    const autoTargetKey = activeTab !== 'all' ? activeTab : null;

    const dmMatch = value.match(/^@(\S+)\s+(.+)$/);
    if (dmMatch) {
      const [, matchedName, text] = dmMatch;
      const peerEntry = Array.from(peers.entries()).find(
        ([key, name]) => name.startsWith(matchedName) || key.startsWith(matchedName)
      );
      if (!peerEntry) {
        addSystemMessage(`Peer '${matchedName}' not found`);
        setInputValue('');
        return;
      }
      const [peerKey] = peerEntry;
      const envelope = createEnvelope('publish', publicKey, privateKey, { text, dm: true });
      relay.send(peerKey, envelope);
      const ownDisplayName = formatDisplayName(broadcastName, publicKey);
      const dmMsg: Message = {
        from: ownDisplayName,
        text: `@${matchedName}: ${text}`,
        timestamp: Date.now(),
        isDM: true,
        peer: peerKey,
      };
      setDmPeers(prev => {
        if (prev.has(peerKey)) return prev;
        const next = new Map(prev);
        next.set(peerKey, peers.get(peerKey) ?? matchedName);
        return next;
      });
      try { appendToConversation(dmMsg, conversationPath); } catch {}
      setChatMessages(prev => [...prev, dmMsg].slice(-MAX_CONVERSATION_LINES));
      setInputValue('');
      return;
    }

    if (autoTargetKey) {
      // In a peer DM tab — send message directly to that peer without @mention
      const peerKey = autoTargetKey;
      const envelope = createEnvelope('publish', publicKey, privateKey, { text: value, dm: true });
      relay.send(peerKey, envelope);
      const ownDisplayName = formatDisplayName(broadcastName, publicKey);
      const dmMsg: Message = {
        from: ownDisplayName,
        text: value,
        timestamp: Date.now(),
        isDM: true,
        peer: peerKey,
      };
      setDmPeers(prev => {
        if (prev.has(peerKey)) return prev;
        const next = new Map(prev);
        next.set(peerKey, peers.get(peerKey) ?? peerKey);
        return next;
      });
      try { appendToConversation(dmMsg, conversationPath); } catch {}
      setChatMessages(prev => [...prev, dmMsg].slice(-MAX_CONVERSATION_LINES));
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
      const outMsg: Message = {
        from: ownDisplayName,
        text: value,
        timestamp: Date.now(),
        isDM: false,
      };
      appendToConversation(outMsg, conversationPath);
      setChatMessages(prev => [...prev, outMsg].slice(-MAX_CONVERSATION_LINES));
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
      <Tabs tabs={tabs} activeTab={activeTab} />
      <Box marginY={1}>
        <MessageList messages={tabMessages} myPublicKey={publicKey} myDisplayName={formatDisplayName(broadcastName, publicKey)} />
      </Box>
      <Input
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        sentHistory={sentHistory}
      />
      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C or type /quit to exit</Text>
      </Box>
    </Box>
  );
}
