import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import { RelayClient } from '@rookdaemon/agora';
import type { Envelope, RelayPeer } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';
import { getIgnoredPeersPath, getSeenKeysPath, IgnoredPeersManager, SeenKeyStore } from '@rookdaemon/agora';
import { compactInlineRefs, expandInlineRefs, expandPeerRef, extractTextFromPayload, formatDisplayName, resolveDisplayName, shortenPeerId } from './utils.js';
import { resolveRecipientReference, resolveRecipientReferences } from './recipient-resolution.js';
import { appendToConversation, loadConversation, trimToByteLimit, formatMessageLine, MAX_CONVERSATION_BYTES, getConversationPath } from './conversation.js';
import { appendToSent } from './sent.js';
import type { Message } from './types.js';
import type { SecurityOptions } from './types.js';
import { InboundMessageGuard } from './security.js';

export interface WebServerOptions {
  relayUrl: string;
  publicKey: string;
  privateKey: string;
  username: string;
  broadcastName?: string;
  configPeers: Record<string, AgoraPeerConfig>;
  conversationPath?: string;
  sentPath?: string;
  ignoredPath?: string;
  seenKeysPath?: string;
  port?: number;
  security?: SecurityOptions;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'darwin') cmd = 'open "' + url + '"';
  else if (platform === 'win32') cmd = 'start "" "' + url + '"';
  else cmd = 'xdg-open "' + url + '"';
  exec(cmd, () => { /* ignore errors — URL is printed to console */ });
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agora Chat</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: #0d1117; color: #c9d1d9; font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace; }
    #root { height: 100%; }
    .app { display: flex; flex-direction: column; height: 100vh; padding: 12px; gap: 8px; max-width: 1100px; margin: 0 auto; }
    .header { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }
    .header-title { display: flex; align-items: center; gap: 10px; }
    .header-title h1 { color: #58a6ff; font-size: 1.1rem; }
    .status { font-size: 0.82rem; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
    .status-connected { background: #1a4731; color: #3fb950; }
    .status-connecting { background: #4d3800; color: #d29922; }
    .status-disconnected { background: #3d1515; color: #f85149; }
    .header-user { font-size: 0.84rem; color: #8b949e; }
    .header-user strong { color: #58a6ff; }
    .header-peers { font-size: 0.84rem; }
    .peers-label { color: #8b949e; }
    .peers-list { color: #3fb950; }
    .peer-item { display: inline-flex; align-items: center; gap: 6px; }
    .peer-link { color: #3fb950; cursor: pointer; text-decoration: none; }
    .peer-link:hover { text-decoration: underline; color: #58a6ff; }
    .peer-toggle { background: #21262d; border: 1px solid #30363d; color: #8b949e; border-radius: 999px; padding: 1px 8px; font-size: 0.72rem; cursor: pointer; font-family: inherit; }
    .peer-toggle:hover { border-color: #58a6ff; color: #58a6ff; }
    .peer-toggle-active { border-color: #f85149; color: #f85149; }
    .peers-empty { color: #484f58; }
    .ignored-section { font-size: 0.82rem; color: #8b949e; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ignored-list { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .ignored-item { display: inline-flex; align-items: center; gap: 6px; padding: 1px 6px; border: 1px solid #30363d; border-radius: 999px; }
    .ignored-name { color: #f85149; }
    .ignored-key { color: #6e7681; font-size: 0.74rem; }
    .tabs { display: flex; gap: 0; background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
    .tab { padding: 6px 14px; font-size: 0.82rem; cursor: pointer; border: none; background: transparent; color: #8b949e; font-family: inherit; transition: background 0.15s, color 0.15s; }
    .tab:hover { background: #21262d; color: #c9d1d9; }
    .tab-active { background: #21262d; color: #58a6ff; font-weight: 600; }
    .tab-wrap { display: inline-flex; align-items: center; }
    .tab-peer { display: inline-flex; align-items: center; gap: 6px; }
    .tab-ignored { color: #f85149; }
    .tab-toggle { background: transparent; border: none; color: #8b949e; cursor: pointer; font-family: inherit; font-size: 0.72rem; padding: 0; }
    .tab-toggle:hover { color: #58a6ff; text-decoration: underline; }
    .tab-toggle-active { color: #f85149; }
    .messages { flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; min-height: 0; }
    .messages-empty { color: #484f58; font-style: italic; font-size: 0.88rem; margin: auto; }
    .msg { font-size: 0.88rem; line-height: 1.5; padding: 1px 0; display: flex; gap: 8px; }
    .msg-time { color: #484f58; flex-shrink: 0; }
    .msg-body { flex: 1; word-break: break-word; }
    .msg-sender { font-weight: 700; }
    .msg-sender-me { color: #58a6ff; }
    .msg-sender-other { color: #3fb950; }
    .msg-system .msg-time, .msg-system .msg-body { color: #6e7681; font-style: italic; }
    .dm-badge { color: #d29922; font-size: 0.78rem; margin-left: 4px; }
    .all-badge { color: #58a6ff; font-size: 0.78rem; margin-left: 4px; }
    .input-row { display: flex; gap: 8px; }
    .input-row textarea { flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 8px 12px; font-family: inherit; font-size: 0.88rem; outline: none; transition: border-color 0.15s; resize: none; }
    .input-row textarea:focus { border-color: #58a6ff; }
    .input-row textarea::placeholder { color: #484f58; }
    .input-row button { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 8px 18px; cursor: pointer; font-family: inherit; font-size: 0.88rem; transition: background 0.15s, border-color 0.15s; white-space: nowrap; align-self: flex-end; }
    .input-row button:hover { background: #30363d; border-color: #58a6ff; color: #58a6ff; }
    .footer { text-align: center; color: #484f58; font-size: 0.76rem; padding: 2px 0; }
    .footer a { color: #484f58; text-decoration: none; }
    .footer a:hover { color: #8b949e; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
  </style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
const { useState, useEffect, useRef } = React;

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Header({ status, username, onlinePeers, ignoredPeers, onPeerClick }) {
  const statusClass = status === 'connected' ? 'status-connected'
    : status === 'connecting' ? 'status-connecting' : 'status-disconnected';
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <div className="header">
      <div className="header-title">
        <h1>&#x2B21; Agora Chat</h1>
        <span className={'status ' + statusClass}>{statusLabel}</span>
      </div>
      <div className="header-user">Logged in as: <strong>{username || '…'}</strong></div>
      <div className="header-peers">
        <span className="peers-label">Online: </span>
        {onlinePeers.length > 0
          ? onlinePeers.map((p, i) => (
              <span key={p.key} className="peer-item">
                {i > 0 && ', '}
                <a className="peer-link" onClick={() => onPeerClick(p)}>{p.name}</a>
              </span>
            ))
          : <span className="peers-empty">No peers online</span>
        }
      </div>
      <div className="ignored-section">
        <span>Ignored:</span>
        {ignoredPeers.length === 0
          ? <span className="peers-empty">None</span>
          : (
            <span className="ignored-list">
              {ignoredPeers.map((key) => {
                const match = onlinePeers.find((peer) => peer.key === key);
                const label = match?.name || ('@' + key.slice(-8));
                return (
                  <span key={key} className="ignored-item">
                    <a className="peer-link ignored-name" onClick={() => onPeerClick({ key, name: label })}>{label}</a>
                    <span className="ignored-key">({key.slice(0, 10)}…)</span>
                  </span>
                );
              })}
            </span>
          )
        }
      </div>
    </div>
  );
}

function MessageItem({ msg, myDisplayName }) {
  const isSystem = msg.from === 'system';
  const isMe = !isSystem && msg.from === myDisplayName;
  const senderClass = isMe ? 'msg-sender-me' : 'msg-sender-other';
  const senderLabel = isMe ? 'You' : msg.from;
  return (
    <div className={'msg' + (isSystem ? ' msg-system' : '')}>
      <span className="msg-time">[{formatTime(msg.timestamp)}]</span>
      <span className="msg-body">
        {!isSystem && <span className={'msg-sender ' + senderClass}>{senderLabel}: </span>}
        <span className="msg-text">{msg.text}</span>
        {!isSystem && <span className="dm-badge">(P2P)</span>}
      </span>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState('connecting');
  const [messages, setMessages] = useState([]);
  const [peers, setPeers] = useState([]);
  const [configPeers, setConfigPeers] = useState({});
  const [username, setUsername] = useState('');
  const [input, setInput] = useState('');
  const [sentHistory, setSentHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [activeTab, setActiveTab] = useState('inbox');
  const [dmPeers, setDmPeers] = useState([]);
  const [groupTabs, setGroupTabs] = useState([]);
  const [ignoredPeers, setIgnoredPeers] = useState([]);
  const draftRef = useRef('');
  const wsRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket('ws://' + location.host);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'status') {
        setStatus(data.value);
      } else if (data.type === 'message') {
        setMessages(prev => [...prev, data]);
      } else if (data.type === 'system') {
        setMessages(prev => [...prev, { ...data, from: 'system' }]);
      } else if (data.type === 'group_tab') {
        if (data.recipients && data.recipients.length > 0) {
          upsertGroupTab(data.recipients);
        } else {
          setMessages(prev => [...prev, { from: 'system', text: data.error || 'No valid recipients for /group', timestamp: Date.now() }]);
        }
      } else if (data.type === 'config_peers') {
        setConfigPeers(data.peers || {});
      } else if (data.type === 'peers') {
        setPeers(data.peers);
        setDmPeers(prev => prev.map(dp => {
          const match = data.peers.find(p => p.key === dp.key);
          return match ? { ...dp, name: match.name } : dp;
        }));
        setGroupTabs(prev => prev.map(group => ({
          ...group,
          label: group.recipients
            .map((peerKey) => data.peers.find((peer) => peer.key === peerKey)?.name || ('@' + peerKey.slice(-8)))
            .join(', '),
        })));
      } else if (data.type === 'info') {
        setUsername(data.username);
      } else if (data.type === 'ignored_peers') {
        setIgnoredPeers(data.peers || []);
      } else if (data.type === 'clear') {
        setMessages([]);
      }
    };

    ws.onclose = () => setStatus('disconnected');

    return () => ws.close();
  }, []);

  useEffect(() => {
    bottomRef.current && bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  const visibleOnlinePeers = peers.filter((peer) => !ignoredPeers.includes(peer.key));
  const allPeerMap = new Map();
  peers.forEach((peer) => allPeerMap.set(peer.key, { key: peer.key, name: peer.name, ignored: ignoredPeers.includes(peer.key) }));
  dmPeers.forEach((peer) => {
    if (!allPeerMap.has(peer.key)) {
      allPeerMap.set(peer.key, { key: peer.key, name: peer.name, ignored: ignoredPeers.includes(peer.key) });
    }
  });
  ignoredPeers.forEach((key) => {
    if (!allPeerMap.has(key)) {
      allPeerMap.set(key, { key, name: '@' + key.slice(-8), ignored: true });
    } else {
      const existing = allPeerMap.get(key);
      allPeerMap.set(key, { ...existing, ignored: true });
    }
  });

  const peerTabs = Array.from(allPeerMap.values()).map((peer) => ({
    id: peer.key,
    label: peer.name,
    peerKey: peer.key,
    recipients: [peer.key],
    ignored: peer.ignored,
  }));

  const tabs = [
    { id: 'inbox', label: 'Inbox', peerKey: null, recipients: [], ignored: false },
    ...peerTabs,
    ...groupTabs,
  ];

  const activeTabMeta = tabs.find((tab) => tab.id === activeTab);
  const visibleMessages = activeTab === 'inbox'
    ? messages
    : messages.filter(m => m.from === 'system' || (m.to && activeTabMeta && m.to.some(key => activeTabMeta.recipients.includes(key))));

  const upsertGroupTab = (recipients) => {
    const unique = Array.from(new Set(recipients)).filter(Boolean).sort();
    if (unique.length <= 1) {
      const peerKey = unique[0];
      if (!peerKey) return;
      const peerName = peers.find((peer) => peer.key === peerKey)?.name || ('@' + peerKey.slice(-8));
      setDmPeers(prev => prev.some(p => p.key === peerKey) ? prev : [...prev, { key: peerKey, name: peerName }]);
      setActiveTab(peerKey);
      return;
    }

    const id = unique.join('|');
    setGroupTabs(prev => {
      const existing = prev.find((tab) => tab.id === id);
      if (existing) return prev;
      const label = unique.map((peerKey) => peers.find((peer) => peer.key === peerKey)?.name || ('@' + peerKey.slice(-8))).join(', ');
      return [...prev, { id, label, peerKey: null, recipients: unique, ignored: false }];
    });
    setActiveTab(id);
  };

  const openPeerTab = (peer) => {
    upsertGroupTab([peer.key]);
  };

  const toggleIgnorePeer = (peerKey) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ignoredPeers.includes(peerKey)) {
      ws.send(JSON.stringify({ type: 'unignore_peer', peerKey }));
    } else {
      ws.send(JSON.stringify({ type: 'ignore_peer', peerKey }));
    }
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setSentHistory(prev => [...prev, text]);
    setHistoryIndex(-1);
    draftRef.current = '';
    if (text.startsWith('/group ') || text.startsWith('/')) {
      if (text.startsWith('/group ')) {
        ws.send(JSON.stringify({ type: 'group_resolve', text }));
      } else {
        ws.send(JSON.stringify({ type: 'command', text }));
      }
    } else if (activeTab !== 'inbox' && !text.startsWith('@')) {
      if (activeTabMeta && activeTabMeta.recipients.length > 1) {
        ws.send(JSON.stringify({ type: 'group_send', text, recipients: activeTabMeta.recipients }));
      } else {
        ws.send(JSON.stringify({ type: 'dm_send', text, peerKey: activeTab }));
      }
    } else {
      ws.send(JSON.stringify({ type: 'send', text }));
    }
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (sentHistory.length === 0) return;
      if (historyIndex === -1) draftRef.current = input;
      const newIdx = historyIndex === -1 ? sentHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      setInput(sentHistory[newIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIdx = historyIndex + 1;
      if (newIdx >= sentHistory.length) {
        setHistoryIndex(-1);
        setInput(draftRef.current);
      } else {
        setHistoryIndex(newIdx);
        setInput(sentHistory[newIdx]);
      }
    }
  };

  const tabPlaceholder = activeTab === 'inbox'
    ? 'Type @peer msg or /group p1,p2 then send'
    : 'Type message to ' + (activeTabMeta?.label || '...');

  return (
    <div className="app">
      <Header status={status} username={username} onlinePeers={visibleOnlinePeers} ignoredPeers={ignoredPeers} onPeerClick={openPeerTab} />
      {tabs.length > 1 && (
        <div className="tabs">
          {tabs.map(tab => (
            <div key={tab.id} className="tab-wrap">
              <button
                className={'tab' + (tab.id === activeTab ? ' tab-active' : '') + (tab.ignored ? ' tab-ignored' : '')}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-peer">{tab.label}</span>
              </button>
              {tab.peerKey && tab.id === activeTab && (
                <button
                  className={'tab-toggle' + (tab.ignored ? ' tab-toggle-active' : '')}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleIgnorePeer(tab.peerKey); }}
                >
                  {tab.ignored ? 'Unignore' : 'Ignore'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="messages">
        {visibleMessages.length === 0
          ? <div className="messages-empty">No messages yet. Type a message and press Enter to send.</div>
          : visibleMessages.map((msg, i) => <MessageItem key={i} msg={msg} myDisplayName={username} />)
        }
        <div ref={bottomRef} />
      </div>
      <div className="input-row">
        <textarea
          rows={4}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tabPlaceholder}
          autoFocus
        />
        <button onClick={sendMessage}>Send</button>
      </div>
      <div className="footer">
        Agora Chat &middot; <a href="https://github.com/rookdaemon/agora" target="_blank">p2p messaging for AI agents</a>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>`;

export function startWebServer(options: WebServerOptions): void {
  const {
    relayUrl, publicKey, privateKey, username, broadcastName,
    configPeers, conversationPath, sentPath, ignoredPath, seenKeysPath, port = 3000,
    security,
  } = options;

  const messages: Message[] = loadConversation(conversationPath, configPeers);
  const peers = new Map<string, string>();
  const ignoredPeersManager = new IgnoredPeersManager(ignoredPath);
  const seenKeyStore = seenKeysPath ? new SeenKeyStore(seenKeysPath) : null;
  for (const peer of security?.ignoredPeers ?? []) {
    ignoredPeersManager.ignorePeer(peer);
  }
  const guard = new InboundMessageGuard({ ...security, ignoredPeers: ignoredPeersManager.listIgnoredPeers() });
  let relayStatus: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  const ownDisplayName = formatDisplayName(broadcastName, publicKey);

  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });

  const wss = new WebSocketServer({ server: httpServer });

  const broadcastToClients = (data: unknown): void => {
    const json = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  };

  const relay = new RelayClient({ relayUrl, publicKey, privateKey, name: broadcastName });

  const broadcastIgnoredPeers = (): void => {
    const ignored = guard.listIgnoredPeers();
    broadcastToClients({ type: 'ignored_peers', peers: ignored });
  };

  const isIgnoredPeer = (peerKey: string): boolean => guard.listIgnoredPeers().includes(peerKey);

  relay.on('connected', () => {
    relayStatus = 'connected';
    broadcastToClients({ type: 'status', value: 'connected' });
    broadcastToClients({ type: 'system', text: 'Connected to relay', timestamp: Date.now() });
    const online = relay.getOnlinePeers();
    for (const p of online) {
      const displayName = formatDisplayName(resolveDisplayName(p.publicKey, configPeers), p.publicKey);
      peers.set(p.publicKey, displayName);
    }
    broadcastToClients({ type: 'peers', peers: Array.from(peers.entries()).map(([key, name]) => ({ key, name })) });
    if (online.length > 0) {
      broadcastToClients({ type: 'system', text: online.length + ' peer(s) online', timestamp: Date.now() });
    }
  });

  relay.on('disconnected', () => {
    relayStatus = 'disconnected';
    broadcastToClients({ type: 'status', value: 'disconnected' });
    broadcastToClients({ type: 'system', text: 'Disconnected from relay', timestamp: Date.now() });
  });

  relay.on('message', (envelope: Envelope, from: string) => {
    // Persist all encountered public keys for identity resolution.
    if (seenKeyStore) {
      if (from) {
        seenKeyStore.record(from);
      }
      for (const recipient of envelope.to ?? []) {
        if (recipient) {
          seenKeyStore.record(recipient);
        }
      }
      seenKeyStore.flush();
    }

    const guardResult = guard.shouldDrop(envelope, from);
    if (guardResult.drop) {
      if (guardResult.reason === 'ignored_peer') {
        return;
      }
      broadcastToClients({ type: 'system', text: 'Dropped inbound message (' + guardResult.reason + ')', timestamp: Date.now() });
      return;
    }

    const displayName = formatDisplayName(resolveDisplayName(from, configPeers), from);
    const text = compactInlineRefs(extractTextFromPayload(envelope.payload), configPeers);
    const msg: Message = { from: displayName, text, timestamp: envelope.timestamp, to: envelope.to };
    messages.push(msg);
    {
      const lines = messages.map(m => formatMessageLine(m));
      const trimmed = trimToByteLimit(lines, MAX_CONVERSATION_BYTES);
      if (trimmed.length < messages.length) messages.splice(0, messages.length - trimmed.length);
    }
    try { appendToConversation(msg, conversationPath, configPeers); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...msg });
  });

  relay.on('peer_online', (peer: RelayPeer) => {
    const displayName = formatDisplayName(resolveDisplayName(peer.publicKey, configPeers), peer.publicKey);
    peers.set(peer.publicKey, displayName);
    broadcastToClients({ type: 'peers', peers: Array.from(peers.entries()).map(([key, name]) => ({ key, name })) });
    if (isIgnoredPeer(peer.publicKey)) {
      return;
    }
    broadcastToClients({ type: 'system', text: displayName + ' came online', timestamp: Date.now() });
  });

  relay.on('peer_offline', (peer: RelayPeer) => {
    const displayName = formatDisplayName(resolveDisplayName(peer.publicKey, configPeers), peer.publicKey);
    peers.delete(peer.publicKey);
    broadcastToClients({ type: 'peers', peers: Array.from(peers.entries()).map(([key, name]) => ({ key, name })) });
    if (isIgnoredPeer(peer.publicKey)) {
      return;
    }
    broadcastToClients({ type: 'system', text: displayName + ' went offline', timestamp: Date.now() });
  });

  relay.on('error', (err: Error) => {
    broadcastToClients({ type: 'system', text: 'Error: ' + err.message, timestamp: Date.now() });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'status', value: relayStatus }));
    ws.send(JSON.stringify({ type: 'info', username }));
    ws.send(JSON.stringify({ type: 'config_peers', peers: configPeers }));
    ws.send(JSON.stringify({ type: 'peers', peers: Array.from(peers.entries()).map(([key, name]) => ({ key, name })) }));
    ws.send(JSON.stringify({ type: 'ignored_peers', peers: guard.listIgnoredPeers() }));
    for (const msg of messages) {
      ws.send(JSON.stringify({ type: 'message', ...msg }));
    }

    ws.on('message', (raw) => {
      let parsed: { type?: string; text?: string; peerKey?: string; recipients?: string[] };
      try {
        parsed = JSON.parse(raw.toString()) as { type?: string; text?: string; peerKey?: string; recipients?: string[] };
      } catch {
        return;
      }
      if (parsed.type === 'send' && parsed.text) {
        void handleSend(parsed.text);
      } else if (parsed.type === 'dm_send' && parsed.text && parsed.peerKey) {
        void handleDmSend(parsed.text, parsed.peerKey);
      } else if (parsed.type === 'group_send' && parsed.text && parsed.recipients && parsed.recipients.length > 0) {
        void handleGroupSend(parsed.text, parsed.recipients);
      } else if (parsed.type === 'group_resolve' && parsed.text) {
        handleGroupResolve(parsed.text, ws);
      } else if (parsed.type === 'command' && parsed.text) {
        handleCommand(parsed.text, ws);
      } else if (parsed.type === 'ignore_peer' && parsed.peerKey) {
        const added = guard.ignorePeer(parsed.peerKey);
        if (added) {
          ignoredPeersManager.ignorePeer(parsed.peerKey);
        }
        ws.send(JSON.stringify({
          type: 'system',
          text: added ? ('Ignoring peer ' + parsed.peerKey) : ('Peer already ignored: ' + parsed.peerKey),
          timestamp: Date.now(),
        }));
        broadcastIgnoredPeers();
      } else if (parsed.type === 'unignore_peer' && parsed.peerKey) {
        const removed = guard.unignorePeer(parsed.peerKey);
        if (removed) {
          ignoredPeersManager.unignorePeer(parsed.peerKey);
        }
        ws.send(JSON.stringify({
          type: 'system',
          text: removed ? ('Removed ignored peer ' + parsed.peerKey) : ('Peer was not ignored: ' + parsed.peerKey),
          timestamp: Date.now(),
        }));
        broadcastIgnoredPeers();
      }
    });
  });

  const resolveRecipientRef = (reference: string): { recipient?: string; reason?: string } => (
    resolveRecipientReference(reference, configPeers, peers, seenKeyStore)
  );

  const handleSend = async (text: string): Promise<void> => {
    try { appendToSent(text, sentPath); } catch { /* ignore */ }

    if (!relay.connected()) {
      broadcastToClients({ type: 'system', text: 'Not connected to relay', timestamp: Date.now() });
      return;
    }

    const dmMatch = text.match(/^@(\S+)\s+(.+)$/);
    if (dmMatch) {
      const [, peerName, dmText] = dmMatch;
      const resolved = resolveRecipientRef(peerName);
      if (resolved.recipient) {
        const peerKey = resolved.recipient;
        const expandedText = expandInlineRefs(dmText.trim(), configPeers, seenKeyStore);
        const result = await relay.sendToRecipients([peerKey], 'publish', { text: expandedText });

        if (!result.ok && result.errors.length > 0) {
          broadcastToClients({ type: 'system', text: `Failed to send to ${peerName}: ${result.errors[0].error}`, timestamp: Date.now() });
          return;
        }

        const dmMsg: Message = {
          from: ownDisplayName,
          text: '@' + peerName + ': ' + compactInlineRefs(expandedText, configPeers),
          timestamp: Date.now(),
          to: [peerKey],
        };
        messages.push(dmMsg);
        try { appendToConversation(dmMsg, conversationPath, configPeers); } catch { /* ignore */ }
        broadcastToClients({ type: 'message', ...dmMsg });
      } else {
        broadcastToClients({ type: 'system', text: `Cannot send DM: ${resolved.reason}. Use /peers to list resolvable keys.`, timestamp: Date.now() });
      }
      return;
    }

    broadcastToClients({ type: 'system', text: 'Broadcast is disabled. Use @peer or create a group tab.', timestamp: Date.now() });
  };

  const handleDmSend = async (text: string, peerKey: string): Promise<void> => {
    try { appendToSent(text, sentPath); } catch { /* ignore */ }

    if (!relay.connected()) {
      broadcastToClients({ type: 'system', text: 'Not connected to relay', timestamp: Date.now() });
      return;
    }

    const resolved = resolveRecipientRef(peerKey);
    if (!resolved.recipient) {
      broadcastToClients({ type: 'system', text: `Cannot send: ${resolved.reason}. Re-open the peer tab from /peers.`, timestamp: Date.now() });
      return;
    }

    const targetPeerKey = resolved.recipient;

    const expandedText = expandInlineRefs(text, configPeers, seenKeyStore);
    const result = await relay.sendToRecipients([targetPeerKey], 'publish', { text: expandedText });

    if (!result.ok && result.errors.length > 0) {
      const peerName = peers.get(targetPeerKey) || ('@' + targetPeerKey.slice(-8));
      broadcastToClients({ type: 'system', text: `Failed to send to ${peerName}: ${result.errors[0].error}`, timestamp: Date.now() });
      return;
    }

    const dmMsg: Message = {
      from: ownDisplayName,
      text: compactInlineRefs(expandedText, configPeers),
      timestamp: Date.now(),
      to: [targetPeerKey],
    };
    messages.push(dmMsg);
    try { appendToConversation(dmMsg, conversationPath, configPeers); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...dmMsg });
  };

  const handleGroupSend = async (text: string, recipients: string[]): Promise<void> => {
    try { appendToSent(text, sentPath); } catch { /* ignore */ }

    if (!relay.connected()) {
      broadcastToClients({ type: 'system', text: 'Not connected to relay', timestamp: Date.now() });
      return;
    }

    const resolvedBatch = resolveRecipientReferences(recipients, configPeers, peers, seenKeyStore);
    const resolutionIssues = resolvedBatch.issues;
    const resolvedRecipients = resolvedBatch.recipients;

    const uniqueRecipients = Array.from(new Set(resolvedRecipients.filter((id) => id !== publicKey)));

    for (const issue of resolutionIssues) {
      broadcastToClients({ type: 'system', text: `Group recipient issue: ${issue}`, timestamp: Date.now() });
    }

    if (uniqueRecipients.length === 0) {
      broadcastToClients({ type: 'system', text: 'Group has no valid recipients after resolution. Use /peers for exact keys.', timestamp: Date.now() });
      return;
    }

    const expandedText = expandInlineRefs(text, configPeers, seenKeyStore);
    const result = await relay.sendToRecipients(uniqueRecipients, 'publish', { text: expandedText });

    // Report any send errors
    if (!result.ok && result.errors.length > 0) {
      for (const err of result.errors) {
        const peerName = peers.get(err.recipient) || ('@' + err.recipient.slice(-8));
        broadcastToClients({ type: 'system', text: `Failed to send to ${peerName}: ${err.error}`, timestamp: Date.now() });
      }
    }

    const groupMsg: Message = {
      from: ownDisplayName,
      text: compactInlineRefs(expandedText, configPeers),
      timestamp: Date.now(),
      to: uniqueRecipients,
    };
    messages.push(groupMsg);
    try { appendToConversation(groupMsg, conversationPath, configPeers); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...groupMsg });
  };

  const handleGroupResolve = (text: string, ws: WebSocket): void => {
    const refs = text.slice('/group '.length).split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
    const batch = resolveRecipientReferences(refs, configPeers, peers, seenKeyStore);
    const unresolved = batch.issues;
    const resolved = Array.from(new Set(batch.recipients)); for (const issue of unresolved) {
      ws.send(JSON.stringify({ type: 'system', text: `Group recipient issue: ${issue}`, timestamp: Date.now() }));
    }

    if (resolved.length === 0) {
      ws.send(JSON.stringify({ type: 'group_tab', recipients: [], error: 'No valid recipients for /group (see recipient issue details above)' }));
    } else {
      ws.send(JSON.stringify({ type: 'group_tab', recipients: resolved }));
    }
  };

  const handleCommand = (cmd: string, ws: WebSocket): void => {
    const lower = cmd.toLowerCase().trim();
    const reply = (text: string) => ws.send(JSON.stringify({ type: 'system', text, timestamp: Date.now() }));

    if (lower === '/clear') {
      broadcastToClients({ type: 'clear' });
      return;
    }
    if (lower === '/peers') {
      if (peers.size === 0) {
        reply('No peers online');
      } else {
        reply('Online peers:');
        peers.forEach((name, pubkey) => reply('  ' + name + ': ' + pubkey));
      }
      return;
    }
    if (lower === '/help') {
      [
        'Commands:',
        '  @peer message — Send to specific peer',
        '  /group <peer1,peer2,...> — Create/switch a group tab',
        '  /peers — List online peers with public keys',
        '  /ignore <pubkey> — Ignore inbound messages from a peer',
        '  /unignore <pubkey> — Remove a peer from ignore list',
        '  /ignored — List ignored peers',
        '  /clear — Clear message history',
        '  /help — Show this help',
      ].forEach(text => reply(text));
      return;
    }

    const ignoreMatch = cmd.match(/^\/ignore\s+(.+)$/i);
    if (ignoreMatch) {
      const key = ignoreMatch[1].trim();
      if (!key) {
        reply('Usage: /ignore <publicKey>');
        return;
      }
      const added = guard.ignorePeer(key);
      if (added) {
        ignoredPeersManager.ignorePeer(key);
      }
      reply(added ? ('Ignoring peer ' + key) : ('Peer already ignored: ' + key));
      broadcastIgnoredPeers();
      return;
    }

    const unignoreMatch = cmd.match(/^\/unignore\s+(.+)$/i);
    if (unignoreMatch) {
      const key = unignoreMatch[1].trim();
      if (!key) {
        reply('Usage: /unignore <publicKey>');
        return;
      }
      const removed = guard.unignorePeer(key);
      if (removed) {
        ignoredPeersManager.unignorePeer(key);
      }
      reply(removed ? ('Removed ignored peer ' + key) : ('Peer was not ignored: ' + key));
      broadcastIgnoredPeers();
      return;
    }

    if (lower === '/ignored') {
      const ignored = guard.listIgnoredPeers();
      if (ignored.length === 0) {
        reply('No ignored peers');
      } else {
        reply('Ignored peers:');
        ignored.forEach((peer) => reply('  ' + peer));
      }
      return;
    }

    reply('Unknown command: ' + cmd + ' (type /help for commands)');
  };

  httpServer.listen(port, () => {
    const url = 'http://localhost:' + port;
    console.log('Agora Chat running at ' + url);
    console.log('Conversation file: ' + (conversationPath ?? getConversationPath()));
    console.log('Ignored peers file: ' + (ignoredPath ?? getIgnoredPeersPath()));
    openBrowser(url);
  });

  relay.connect();

  // Prevent relay connection failures from crashing the process.
  // The relay 'error' event handler above sends the error to connected clients.
  // Some underlying ws errors (e.g. DNS failures) surface as unhandled rejections.
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    broadcastToClients({ type: 'system', text: 'Relay error: ' + msg, timestamp: Date.now() });
  });

  process.on('SIGINT', () => {
    relay.disconnect();
    httpServer.close();
    process.exit(0);
  });
}
