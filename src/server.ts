import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import { RelayClient, createEnvelope } from '@rookdaemon/agora';
import type { Envelope, RelayPeer } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';
import { resolveDisplayName, formatDisplayName, sanitizeText } from './utils.js';
import { appendToConversation, loadConversation, MAX_CONVERSATION_LINES } from './conversation.js';
import { appendToSent } from './sent.js';
import type { Message } from './types.js';

export interface WebServerOptions {
  relayUrl: string;
  publicKey: string;
  privateKey: string;
  username: string;
  broadcastName?: string;
  configPeers: Record<string, AgoraPeerConfig>;
  conversationPath?: string;
  sentPath?: string;
  port?: number;
}

function extractTextFromPayload(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload && typeof (payload as { text: unknown }).text === 'string') {
    return sanitizeText((payload as { text: string }).text);
  }
  if (typeof payload === 'string') return sanitizeText(payload);
  return sanitizeText(JSON.stringify(payload ?? ''));
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
    .peers-empty { color: #484f58; }
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
    .input-row input { flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 8px 12px; font-family: inherit; font-size: 0.88rem; outline: none; transition: border-color 0.15s; }
    .input-row input:focus { border-color: #58a6ff; }
    .input-row input::placeholder { color: #484f58; }
    .input-row button { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 8px 18px; cursor: pointer; font-family: inherit; font-size: 0.88rem; transition: background 0.15s, border-color 0.15s; white-space: nowrap; }
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

function Header({ status, username, onlinePeers }) {
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
          ? <span className="peers-list">{onlinePeers.join(', ')}</span>
          : <span className="peers-empty">No peers online</span>
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
        {!isSystem && (msg.isDM ? <span className="dm-badge">(DM)</span> : <span className="all-badge">(ALL)</span>)}
      </span>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState('connecting');
  const [messages, setMessages] = useState([]);
  const [peers, setPeers] = useState([]);
  const [username, setUsername] = useState('');
  const [input, setInput] = useState('');
  const [sentHistory, setSentHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
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
      } else if (data.type === 'peers') {
        setPeers(data.peers);
      } else if (data.type === 'info') {
        setUsername(data.username);
      } else if (data.type === 'clear') {
        setMessages([]);
      }
    };

    ws.onclose = () => setStatus('disconnected');

    return () => ws.close();
  }, []);

  useEffect(() => {
    bottomRef.current && bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setSentHistory(prev => [...prev, text]);
    setHistoryIndex(-1);
    draftRef.current = '';
    ws.send(JSON.stringify(text.startsWith('/') ? { type: 'command', text } : { type: 'send', text }));
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
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

  return (
    <div className="app">
      <Header status={status} username={username} onlinePeers={peers} />
      <div className="messages">
        {messages.length === 0
          ? <div className="messages-empty">No messages yet. Type a message and press Enter to send.</div>
          : messages.map((msg, i) => <MessageItem key={i} msg={msg} myDisplayName={username} />)
        }
        <div ref={bottomRef} />
      </div>
      <div className="input-row">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type message (@peer for DM, /help for commands)"
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
    configPeers, conversationPath, sentPath, port = 3000,
  } = options;

  const messages: Message[] = loadConversation(conversationPath);
  const peers = new Map<string, string>();
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

  relay.on('connected', () => {
    relayStatus = 'connected';
    broadcastToClients({ type: 'status', value: 'connected' });
    broadcastToClients({ type: 'system', text: 'Connected to relay', timestamp: Date.now() });
    const online = relay.getOnlinePeers();
    for (const p of online) {
      const displayName = formatDisplayName(resolveDisplayName(p.publicKey, p.name, configPeers), p.publicKey);
      peers.set(p.publicKey, displayName);
    }
    broadcastToClients({ type: 'peers', peers: Array.from(peers.values()) });
    if (online.length > 0) {
      broadcastToClients({ type: 'system', text: online.length + ' peer(s) online', timestamp: Date.now() });
    }
  });

  relay.on('disconnected', () => {
    relayStatus = 'disconnected';
    broadcastToClients({ type: 'status', value: 'disconnected' });
    broadcastToClients({ type: 'system', text: 'Disconnected from relay', timestamp: Date.now() });
  });

  relay.on('message', (envelope: Envelope, from: string, fromName?: string) => {
    const displayName = formatDisplayName(resolveDisplayName(from, fromName, configPeers), from);
    const text = extractTextFromPayload(envelope.payload);
    const msg: Message = { from: displayName, text, timestamp: envelope.timestamp, isDM: false };
    messages.push(msg);
    if (messages.length > MAX_CONVERSATION_LINES) {
      messages.splice(0, messages.length - MAX_CONVERSATION_LINES);
    }
    try { appendToConversation(msg, conversationPath); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...msg });
  });

  relay.on('peer_online', (peer: RelayPeer) => {
    const displayName = formatDisplayName(resolveDisplayName(peer.publicKey, peer.name, configPeers), peer.publicKey);
    peers.set(peer.publicKey, displayName);
    broadcastToClients({ type: 'peers', peers: Array.from(peers.values()) });
    broadcastToClients({ type: 'system', text: displayName + ' came online', timestamp: Date.now() });
  });

  relay.on('peer_offline', (peer: RelayPeer) => {
    const displayName = formatDisplayName(resolveDisplayName(peer.publicKey, peer.name, configPeers), peer.publicKey);
    peers.delete(peer.publicKey);
    broadcastToClients({ type: 'peers', peers: Array.from(peers.values()) });
    broadcastToClients({ type: 'system', text: displayName + ' went offline', timestamp: Date.now() });
  });

  relay.on('error', (err: Error) => {
    broadcastToClients({ type: 'system', text: 'Error: ' + err.message, timestamp: Date.now() });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'status', value: relayStatus }));
    ws.send(JSON.stringify({ type: 'info', username }));
    ws.send(JSON.stringify({ type: 'peers', peers: Array.from(peers.values()) }));
    for (const msg of messages) {
      ws.send(JSON.stringify({ type: 'message', ...msg }));
    }

    ws.on('message', (raw) => {
      let parsed: { type?: string; text?: string };
      try {
        parsed = JSON.parse(raw.toString()) as { type?: string; text?: string };
      } catch {
        return;
      }
      if (parsed.type === 'send' && parsed.text) {
        handleSend(parsed.text);
      } else if (parsed.type === 'command' && parsed.text) {
        handleCommand(parsed.text, ws);
      }
    });
  });

  const handleSend = (text: string): void => {
    try { appendToSent(text, sentPath); } catch { /* ignore */ }

    if (!relay.connected()) {
      broadcastToClients({ type: 'system', text: 'Not connected to relay', timestamp: Date.now() });
      return;
    }

    const dmMatch = text.match(/^@(\S+)\s+(.+)$/);
    if (dmMatch) {
      const [, peerName, dmText] = dmMatch;
      const peerEntry = Array.from(peers.entries()).find(
        ([key, name]) => name.startsWith(peerName) || key.startsWith(peerName)
      );
      if (peerEntry) {
        const [peerKey] = peerEntry;
        const envelope = createEnvelope('publish', publicKey, privateKey, { text: dmText });
        relay.send(peerKey, envelope);
        const dmMsg: Message = { from: ownDisplayName, text: '@' + peerName + ': ' + dmText, timestamp: Date.now(), isDM: true };
        messages.push(dmMsg);
        try { appendToConversation(dmMsg, conversationPath); } catch { /* ignore */ }
        broadcastToClients({ type: 'message', ...dmMsg });
      } else {
        broadcastToClients({ type: 'system', text: "Peer '" + peerName + "' not found", timestamp: Date.now() });
      }
      return;
    }

    if (peers.size === 0) {
      broadcastToClients({ type: 'system', text: 'No peers online to send message to', timestamp: Date.now() });
      return;
    }

    const envelope = createEnvelope('publish', publicKey, privateKey, { text });
    relay.broadcast(envelope);
    const outMsg: Message = { from: ownDisplayName, text, timestamp: Date.now(), isDM: false };
    messages.push(outMsg);
    if (messages.length > MAX_CONVERSATION_LINES) {
      messages.splice(0, messages.length - MAX_CONVERSATION_LINES);
    }
    try { appendToConversation(outMsg, conversationPath); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...outMsg });
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
        '  @peer message — Send DM to specific peer',
        '  /peers — List online peers with public keys',
        '  /clear — Clear message history',
        '  /help — Show this help',
      ].forEach(text => reply(text));
      return;
    }
    reply('Unknown command: ' + cmd + ' (type /help for commands)');
  };

  httpServer.listen(port, () => {
    const url = 'http://localhost:' + port;
    console.log('Agora Chat running at ' + url);
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
