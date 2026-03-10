import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { RelayClient } from '@rookdaemon/agora';
import type { Envelope, RelayPeer } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { Input } from './components/Input.js';
import { Tabs } from './components/Tabs.js';
import type { TabItem } from './components/Tabs.js';
import { compactInlineRefs, expandInlineRefs, expandPeerRef, extractTextFromPayload, formatDisplayName, resolveDisplayName, shortenPeerId } from './utils.js';
import { appendToConversation, loadConversation, loadOlderMessages, trimToByteLimit, formatMessageLine, MAX_CONVERSATION_BYTES, LOAD_MORE_PAGE_SIZE } from './conversation.js';
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

interface GroupTab {
  id: string;
  recipients: string[];
  label: string;
}

function trimMessages(msgs: Message[]): Message[] {
  const lines = msgs.map(m => formatMessageLine(m));
  const trimmed = trimToByteLimit(lines, MAX_CONVERSATION_BYTES);
  return msgs.slice(msgs.length - trimmed.length);
}

function createGroupId(recipients: string[]): string {
  return recipients.slice().sort().join('|');
}

export function App({ relayUrl, publicKey, privateKey, username, broadcastName, configPeers, conversationPath, sentPath }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [systemMessages, setSystemMessages] = useState<Message[]>([]);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [peers, setPeers] = useState<Map<string, string>>(new Map());
  const [sentHistory, setSentHistory] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('inbox');
  const [groupTabs, setGroupTabs] = useState<Map<string, GroupTab>>(new Map());
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(false);
  const relayRef = useRef<RelayClient | null>(null);

  const messages = useMemo(
    () => [...systemMessages, ...chatMessages].sort((a, b) => a.timestamp - b.timestamp),
    [systemMessages, chatMessages]
  );

  const tabs = useMemo<TabItem[]>(() => {
    const groups = Array.from(groupTabs.values()).map((group) => ({ id: group.id, label: group.label }));
    return [{ id: 'inbox', label: 'Inbox' }, ...groups];
  }, [groupTabs]);

  const tabMessages = useMemo(() => {
    if (activeTab === 'inbox') {
      return messages;
    }
    const group = groupTabs.get(activeTab);
    if (!group) {
      return messages;
    }
    return messages.filter((msg) => msg.from === 'system' || (msg.to?.some(key => group.recipients.includes(key)) ?? false));
  }, [messages, activeTab, groupTabs]);

  const addSystemMessage = (text: string): void => {
    setSystemMessages((prev) => [...prev, { from: 'system', text, timestamp: Date.now() }]);
  };

  const loadMoreMessages = (): void => {
    const oldest = chatMessages.reduce<Message | null>(
      (min, m) => m.from !== 'system' && (min === null || m.timestamp < min.timestamp) ? m : min,
      null
    );
    const beforeTimestamp = oldest ? oldest.timestamp : Date.now();
    const older = loadOlderMessages(beforeTimestamp, LOAD_MORE_PAGE_SIZE, conversationPath, configPeers);
    if (older.length === 0) {
      setHasMoreMessages(false);
      addSystemMessage('No older messages to load');
      return;
    }
    setChatMessages((prev) => [...older, ...prev]);
  };

  const resolvePeerRef = (ref: string): string | undefined => {
    const byConfig = expandPeerRef(ref, configPeers);
    if (byConfig) {
      return byConfig;
    }

    for (const [peerKey, displayName] of peers.entries()) {
      if (peerKey.startsWith(ref) || displayName.startsWith(ref) || displayName.includes(ref)) {
        return peerKey;
      }
      if (ref.startsWith('...') && peerKey.endsWith(ref.slice(3))) {
        return peerKey;
      }
    }

    return undefined;
  };

  const ensureGroupTab = (recipients: string[]): string => {
    const cleaned = Array.from(new Set(recipients.filter((id) => id !== publicKey))).sort();
    const id = createGroupId(cleaned);
    if (!id) {
      return 'inbox';
    }

    setGroupTabs((prev) => {
      if (prev.has(id)) return prev;
      const label = cleaned
        .map((peerId) => peers.get(peerId) ?? `${shortenPeerId(peerId, configPeers)}`)
        .join(',');
      const next = new Map(prev);
      next.set(id, { id, recipients: cleaned, label });
      return next;
    });

    return id;
  };

  useInput((input, key) => {
    if (key.pageUp) {
      loadMoreMessages();
      return;
    }

    if (key.tab && tabs.length > 1) {
      const ids = tabs.map((t) => t.id);
      const next = (ids.indexOf(activeTab) + 1) % ids.length;
      setActiveTab(ids[next]);
    }

    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9) {
      const peerEntries = Array.from(peers.entries());
      if (num <= peerEntries.length) {
        const [peerKey] = peerEntries[num - 1];
        const tabId = ensureGroupTab([peerKey]);
        setActiveTab(tabId);
      }
    }
  });

  useEffect(() => {
    const { messages: loaded, hasMore } = loadConversation(conversationPath, configPeers);
    setChatMessages(loaded);
    setHasMoreMessages(hasMore);
    for (const msg of loaded) {
      if (msg.to && msg.to.length > 0) {
        ensureGroupTab(msg.to);
      }
    }
  }, [conversationPath]);

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
      addSystemMessage('Connected to relay');
      const online = client.getOnlinePeers();
      setPeers((prev) => {
        const next = new Map(prev);
        for (const peer of online) {
          const resolvedName = resolveDisplayName(peer.publicKey, configPeers);
          const displayName = formatDisplayName(resolvedName, peer.publicKey);
          next.set(peer.publicKey, displayName);
        }
        return next;
      });
    });

    client.on('disconnected', () => {
      setStatus('disconnected');
      addSystemMessage('Disconnected from relay');
    });

    client.on('message', (envelope: Envelope, from: string) => {
      const resolvedName = resolveDisplayName(from, configPeers);
      const displayName = formatDisplayName(resolvedName, from);
      const expandedText = extractTextFromPayload(envelope.payload);
      const text = compactInlineRefs(expandedText, configPeers);
      const msg: Message = {
        from: displayName,
        text,
        timestamp: envelope.timestamp,
        to: [from],
      };
      const tabId = ensureGroupTab([from]);
      if (activeTab === 'inbox') {
        setActiveTab(tabId);
      }
      setChatMessages((prev) => trimMessages([...prev, msg]));
      try { appendToConversation(msg, conversationPath, configPeers); } catch { }
    });

    client.on('peer_online', (peer: RelayPeer) => {
      const resolvedName = resolveDisplayName(peer.publicKey, configPeers);
      const displayName = formatDisplayName(resolvedName, peer.publicKey);
      setPeers((prev) => {
        const next = new Map(prev);
        next.set(peer.publicKey, displayName);
        return next;
      });
      addSystemMessage(`${displayName} came online`);
    });

    client.on('peer_offline', (peer: RelayPeer) => {
      const resolvedName = resolveDisplayName(peer.publicKey, configPeers);
      const displayName = formatDisplayName(resolvedName, peer.publicKey);
      setPeers((prev) => {
        const next = new Map(prev);
        next.delete(peer.publicKey);
        return next;
      });
      addSystemMessage(`${displayName} went offline`);
    });

    client.on('error', (err: Error) => {
      addSystemMessage(`Error: ${err.message}`);
    });

    relayRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      relayRef.current = null;
    };
  }, [relayUrl, publicKey, privateKey, broadcastName, configPeers]);

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
      addSystemMessage('  1-9 - Open peer tab for numbered peer');
      addSystemMessage('  /group <peer1 peer2 ...> - Create/switch group tab (comma or space separated)');
      addSystemMessage('  @peer message - Send to one peer');
      addSystemMessage('  /peers - List online peers with full IDs');
      addSystemMessage('  /clear - Clear message history');
      addSystemMessage('  /help - Show this help');
      addSystemMessage('  /quit - Exit the chat');
      addSystemMessage('  Tab - Switch tabs');
      addSystemMessage('  PgUp - Load older messages');
      return true;
    }

    if (cmd === '/peers') {
      if (peers.size === 0) {
        addSystemMessage('No peers online');
      } else {
        addSystemMessage('Online peers:');
        peers.forEach((name, pubkey) => addSystemMessage(`  ${name}: ${pubkey}`));
      }
      return true;
    }

    if (cmd.startsWith('/group ')) {
      const raw = command.slice('/group '.length).trim();
      const refs = raw.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
      const recipients = Array.from(new Set(refs.map((ref) => resolvePeerRef(ref)).filter((v): v is string => Boolean(v))));
      if (recipients.length === 0) {
        addSystemMessage('No valid peers found for group');
        return true;
      }
      const tabId = ensureGroupTab(recipients);
      setActiveTab(tabId);
      addSystemMessage(`Group ready: ${recipients.map((id) => shortenPeerId(id, configPeers)).join(', ')}`);
      return true;
    }

    return false;
  };

  const sendToRecipients = (rawText: string, recipients: string[]): void => {
    const relay = relayRef.current;
    if (!relay?.connected()) {
      addSystemMessage('Not connected to relay');
      return;
    }

    const cleanedRecipients = Array.from(new Set(recipients.filter((id) => id !== publicKey)));
    if (cleanedRecipients.length === 0) {
      addSystemMessage('No valid recipients selected');
      return;
    }

    const expandedText = expandInlineRefs(rawText, configPeers);
    void relay.sendToRecipients(cleanedRecipients, 'publish', { text: expandedText });

    const ownDisplayName = formatDisplayName(broadcastName, publicKey);
    const msg: Message = {
      from: ownDisplayName,
      text: compactInlineRefs(expandedText, configPeers),
      timestamp: Date.now(),
      to: cleanedRecipients,
    };
    setChatMessages((prev) => trimMessages([...prev, msg]));
    try { appendToConversation(msg, conversationPath, configPeers); } catch { };
  };

  const handleSubmit = (value: string): void => {
    if (!value.trim()) {
      setInputValue('');
      return;
    }

    try { appendToSent(value, sentPath); } catch { }
    setSentHistory((prev) => [...prev, value]);

    if (value.startsWith('/')) {
      handleCommand(value);
      setInputValue('');
      return;
    }

    const mention = value.match(/^@([^\s]+)\s+(.+)$/);
    if (mention) {
      const [, ref, text] = mention;
      const recipient = resolvePeerRef(ref);
      if (!recipient) {
        addSystemMessage(`Peer '${ref}' not found`);
        setInputValue('');
        return;
      }
      const tabId = ensureGroupTab([recipient]);
      setActiveTab(tabId);
      sendToRecipients(text, [recipient]);
      setInputValue('');
      return;
    }

    if (activeTab === 'inbox') {
      addSystemMessage('Select a peer tab or create a group (/group ...) before sending');
      setInputValue('');
      return;
    }

    const group = groupTabs.get(activeTab);
    if (!group) {
      addSystemMessage('Active tab is invalid');
      setInputValue('');
      return;
    }

    sendToRecipients(value, group.recipients);
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
        <MessageList messages={tabMessages} myPublicKey={publicKey} myDisplayName={formatDisplayName(broadcastName, publicKey)} hasMoreMessages={hasMoreMessages} />
      </Box>
      <Input
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        sentHistory={sentHistory}
      />
      <Box marginTop={1}>
        <Text dimColor>Use /group to create recipient tabs. Press Ctrl+C or type /quit to exit.</Text>
      </Box>
    </Box>
  );
}
