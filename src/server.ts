import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import { RelayClient } from '@rookdaemon/agora';
import type { Envelope, RelayPeer } from '@rookdaemon/agora';
import type { AgoraPeerConfig } from '@rookdaemon/agora';
import { getIgnoredPeersPath, getSeenKeysPath, IgnoredPeersManager, SeenKeyStore } from '@rookdaemon/agora';
import { compactInlineRefs, expandInlineRefs, expandPeerRef, extractTextFromPayload, formatDisplayName, resolveDisplayName, shortenPeerId } from './utils.js';
import { resolveRecipientReference, resolveRecipientReferences } from './recipient-resolution.js';
import { appendToConversation, loadConversation, loadOlderMessages, trimToByteLimit, formatMessageLine, generateMessageId, MAX_CONVERSATION_BYTES, LOAD_MORE_PAGE_SIZE, getConversationPath } from './conversation.js';
import { appendToSent } from './sent.js';
import type { Message } from './types.js';
import type { SecurityOptions } from './types.js';
import { InboundMessageGuard } from './security.js';
import { findUnknownPeers, addPeerToConfig } from './peer-suggestions.js';

export interface WebServerOptions {
  relayUrl: string;
  publicKey: string;
  privateKey: string;
  username: string;
  broadcastName?: string;
  configPeers: Record<string, AgoraPeerConfig>;
  configPath?: string;
  conversationPath?: string;
  sentPath?: string;
  ignoredPath?: string;
  seenKeysPath?: string;
  port?: number;
  security?: SecurityOptions;
}

function parseNameFromDisplay(displayName?: string): string | undefined {
  if (!displayName || displayName.startsWith('@')) return undefined;
  const atIndex = displayName.lastIndexOf('@');
  if (atIndex <= 0) return undefined;
  const parsed = displayName.slice(0, atIndex).trim();
  return parsed.length > 0 ? parsed : undefined;
}

export function resolveLocalName(
  publicKey: string,
  broadcastName: string | undefined,
  configPeers: Record<string, AgoraPeerConfig>,
  fallbackDisplayName?: string,
): string | undefined {
  if (broadcastName && broadcastName.trim().length > 0) {
    return broadcastName.trim();
  }
  const fromPeers = Object.values(configPeers).find(
    (peer) => peer?.publicKey === publicKey && typeof peer.name === 'string' && peer.name.trim().length > 0,
  )?.name;
  if (fromPeers && fromPeers.trim().length > 0) {
    return fromPeers.trim();
  }
  return parseNameFromDisplay(fallbackDisplayName);
}

export function normalizeRecipientsForGrouping(recipients: string[], selfPublicKey?: string): string[] {
  return Array.from(new Set(recipients.filter((id) => !!id && id !== selfPublicKey))).sort();
}

export function shortHash(input: string): string {
  // FNV-1a 32-bit hash for stable, compact tab identifiers.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

export function deriveTabFromParticipants(
  participants: string[],
  selfPublicKey: string,
  configPeers: Record<string, AgoraPeerConfig>,
): { id: string; recipients: string[]; label: string; canonical: string } | null {
  const canonicalIds = Array.from(new Set(participants.filter(Boolean))).sort();
  if (canonicalIds.length === 0) return null;

  const canonical = canonicalIds.join(',');
  const id = 'tab-' + shortHash(canonical);
  const recipients = canonicalIds.filter((id) => id !== selfPublicKey);
  const label = recipients.length > 0
    ? recipients.map((key) => shortenPeerId(key, configPeers)).join(', ')
    : 'Self';

  return { id, recipients, label, canonical };
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
    .load-more-wrap { position: sticky; top: 0; display: flex; justify-content: center; padding: 4px 0 6px; z-index: 1; }
    .load-more { background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #8b949e; font-size: 0.8rem; cursor: pointer; padding: 3px 12px; }
    .load-more:hover { border-color: #8b949e; color: #c9d1d9; }
    .new-msg-pill { position: sticky; bottom: 8px; align-self: center; background: #1f6feb; color: #fff; border: none; border-radius: 16px; padding: 5px 16px; font-size: 0.82rem; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.4); z-index: 2; }
    .new-msg-pill:hover { background: #388bfd; }
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
    .suggestions { display: flex; flex-direction: column; gap: 6px; }
    .suggestion { background: #1c2128; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 0.84rem; }
    .suggestion-text { color: #8b949e; flex: 1; }
    .suggestion-text strong { color: #d29922; }
    .suggestion-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .suggestion-btn { background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; padding: 3px 12px; cursor: pointer; font-family: inherit; font-size: 0.78rem; transition: background 0.15s, border-color 0.15s; }
    .suggestion-btn:hover { background: #30363d; border-color: #8b949e; }
    .suggestion-btn-yes { border-color: #3fb950; color: #3fb950; }
    .suggestion-btn-yes:hover { background: #1a4731; border-color: #3fb950; }
    .suggestion-btn-no { border-color: #f85149; color: #f85149; }
    .suggestion-btn-no:hover { background: #3d1515; border-color: #f85149; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
  </style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/ui.js"></script>
</body>
</html>`;

export function startWebServer(options: WebServerOptions): void {
  const uiJs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ui.js'), 'utf-8');

  const {
    relayUrl, publicKey, privateKey, username, broadcastName,
    configPeers, configPath, conversationPath, sentPath, ignoredPath, seenKeysPath, port = 1337,
    security,
  } = options;

  const localName = resolveLocalName(publicKey, broadcastName, configPeers, username);

  // Add local user to configPeers so they can be looked up by publicKey
  const configPeersWithSelf: Record<string, AgoraPeerConfig> = {
    ...configPeers,
    [publicKey]: {
      publicKey,
      name: localName,
    },
  };

  const { messages, hasMore: initialHasMore } = loadConversation(conversationPath, configPeersWithSelf);
  const peers = new Map<string, string>();
  const ignoredPeersManager = new IgnoredPeersManager(ignoredPath);
  const seenKeyStore = seenKeysPath ? new SeenKeyStore(seenKeysPath) : null;
  for (const peer of security?.ignoredPeers ?? []) {
    ignoredPeersManager.ignorePeer(peer);
  }
  const guard = new InboundMessageGuard({ ...security, ignoredPeers: ignoredPeersManager.listIgnoredPeers() });
  let relayStatus: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  const ownDisplayName = formatDisplayName(localName, publicKey);

  // Track peers already suggested or dismissed this session to avoid repeated prompts.
  const suggestedPeerKeys = new Set<string>();

  const suggestUnknownPeers = (recipients: string[]): void => {
    if (!configPath) return;
    const unknown = findUnknownPeers(recipients, configPeersWithSelf, publicKey);
    for (const key of unknown) {
      if (suggestedPeerKeys.has(key)) continue;
      suggestedPeerKeys.add(key);
      const displayName = peers.get(key) ?? ('@' + key.slice(-8));
      broadcastToClients({ type: 'peer_suggestion', peerKey: key, displayName, timestamp: Date.now() });
    }
  };

  console.error('[DEBUG] startWebServer:');
  console.error('[DEBUG]   publicKey:', publicKey.slice(-16));
  console.error('[DEBUG]   broadcastName:', broadcastName);
  console.error('[DEBUG]   username (from CLI):', username);
  console.error('[DEBUG]   localName (resolved):', localName);
  console.error('[DEBUG]   ownDisplayName:', ownDisplayName);
  console.error('[DEBUG]   configPeersWithSelf has local user:', publicKey in configPeersWithSelf);

  const httpServer = createServer((req, res) => {
    if (req.url === '/ui.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(uiJs);
      return;
    }
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

  const relay = new RelayClient({ relayUrl, publicKey, privateKey, name: localName });

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
      const resolvedName = resolveDisplayName(p.publicKey, configPeersWithSelf);
      const displayName = formatDisplayName(resolvedName, p.publicKey);
      peers.set(p.publicKey, displayName);
    }
    // Include local user in peers list
    const peersWithSelf = new Map(peers);
    peersWithSelf.set(publicKey, ownDisplayName);
    broadcastToClients({ type: 'peers', peers: Array.from(peersWithSelf.entries()).map(([key, name]) => ({ key, name })) });
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

    const displayName = formatDisplayName(resolveDisplayName(from, configPeersWithSelf), from);
    const text = compactInlineRefs(extractTextFromPayload(envelope.payload), configPeersWithSelf);
    const msg: Message = { from: displayName, fromKey: from, text, timestamp: envelope.timestamp, to: envelope.to };
    msg.id = generateMessageId(msg);
    messages.push(msg);
    {
      const lines = messages.map(m => formatMessageLine(m));
      const trimmed = trimToByteLimit(lines, MAX_CONVERSATION_BYTES);
      if (trimmed.length < messages.length) messages.splice(0, messages.length - trimmed.length);
    }
    try { appendToConversation(msg, conversationPath, configPeersWithSelf); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...msg });
    suggestUnknownPeers([from]);
  });

  relay.on('peer_online', (peer: RelayPeer) => {
    const resolvedName = resolveDisplayName(peer.publicKey, configPeersWithSelf);
    const displayName = formatDisplayName(resolvedName, peer.publicKey);
    peers.set(peer.publicKey, displayName);
    // Include local user in peers list
    const peersWithSelf = new Map(peers);
    peersWithSelf.set(publicKey, ownDisplayName);
    broadcastToClients({ type: 'peers', peers: Array.from(peersWithSelf.entries()).map(([key, name]) => ({ key, name })) });
    if (isIgnoredPeer(peer.publicKey)) {
      return;
    }
    broadcastToClients({ type: 'system', text: displayName + ' came online', timestamp: Date.now() });
  });

  relay.on('peer_offline', (peer: RelayPeer) => {
    const resolvedName = resolveDisplayName(peer.publicKey, configPeersWithSelf);
    const displayName = formatDisplayName(resolvedName, peer.publicKey);
    peers.delete(peer.publicKey);
    // Include local user in peers list
    const peersWithSelf = new Map(peers);
    peersWithSelf.set(publicKey, ownDisplayName);
    broadcastToClients({ type: 'peers', peers: Array.from(peersWithSelf.entries()).map(([key, name]) => ({ key, name })) });
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
    ws.send(JSON.stringify({ type: 'info', username: ownDisplayName, publicKey }));
    ws.send(JSON.stringify({ type: 'config_peers', peers: configPeersWithSelf }));

    // Include local user in peers list for simplicity
    const peersWithSelf = new Map(peers);
    peersWithSelf.set(publicKey, ownDisplayName);
    ws.send(JSON.stringify({ type: 'peers', peers: Array.from(peersWithSelf.entries()).map(([key, name]) => ({ key, name })) }));
    ws.send(JSON.stringify({ type: 'ignored_peers', peers: guard.listIgnoredPeers() }));

    // Tabs are reconstructed client-side from each message's participant set.

    for (const msg of messages) {
      ws.send(JSON.stringify({ type: 'message', ...msg }));
    }
    ws.send(JSON.stringify({ type: 'has_more', value: initialHasMore }));

    ws.on('message', (raw) => {
      let parsed: { type?: string; text?: string; peerKey?: string; recipients?: string[]; beforeTimestamp?: number };
      try {
        parsed = JSON.parse(raw.toString()) as { type?: string; text?: string; peerKey?: string; recipients?: string[]; beforeTimestamp?: number };
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
      } else if (parsed.type === 'add_peer' && parsed.peerKey) {
        if (!configPath) {
          ws.send(JSON.stringify({ type: 'system', text: 'Cannot add peer: no config path available', timestamp: Date.now() }));
        } else {
          const peerName = (parsed as { peerName?: string }).peerName;
          const result = addPeerToConfig(configPath, parsed.peerKey, peerName);
          if (result.ok) {
            // Update in-memory configPeers
            const entry = { publicKey: parsed.peerKey, name: peerName };
            configPeersWithSelf[parsed.peerKey] = entry;
            broadcastToClients({ type: 'config_peers', peers: configPeersWithSelf });
            ws.send(JSON.stringify({ type: 'system', text: `Added peer ${peerName ?? parsed.peerKey.slice(-8)} to config`, timestamp: Date.now() }));
          } else {
            ws.send(JSON.stringify({ type: 'system', text: `Failed to add peer: ${result.error}`, timestamp: Date.now() }));
          }
        }
        broadcastToClients({ type: 'dismiss_peer_suggestion', peerKey: parsed.peerKey });
      } else if (parsed.type === 'dismiss_peer_suggestion' && parsed.peerKey) {
        // No-op server-side; client removes the suggestion banner.
        // Key already tracked in suggestedPeerKeys so it won't re-appear.
      } else if (parsed.type === 'load_more' && typeof parsed.beforeTimestamp === 'number') {
        const { messages: older, hasMore } = loadOlderMessages(parsed.beforeTimestamp, LOAD_MORE_PAGE_SIZE, conversationPath, configPeersWithSelf);
        ws.send(JSON.stringify({ type: 'older_messages', messages: older, hasMore }));
      }
    });
  });

  const resolveRecipientRef = (reference: string): { recipient?: string; reason?: string } => (
    resolveRecipientReference(reference, configPeersWithSelf, peers, seenKeyStore)
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
        const expandedText = expandInlineRefs(dmText.trim(), configPeersWithSelf, seenKeyStore);
        const result = await relay.sendToRecipients([peerKey], 'publish', { text: expandedText });

        if (!result.ok && result.errors.length > 0) {
          broadcastToClients({ type: 'system', text: `Failed to send to ${peerName}: ${result.errors[0].error}`, timestamp: Date.now() });
          return;
        }

        const dmMsg: Message = {
          from: ownDisplayName,
          fromKey: publicKey,
          text: '@' + peerName + ': ' + compactInlineRefs(expandedText, configPeersWithSelf),
          timestamp: Date.now(),
          to: [peerKey],
        };
        dmMsg.id = generateMessageId(dmMsg);
        messages.push(dmMsg);
        try { appendToConversation(dmMsg, conversationPath, configPeersWithSelf); } catch { /* ignore */ }
        broadcastToClients({ type: 'message', ...dmMsg });
        suggestUnknownPeers([peerKey]);
      } else {
        broadcastToClients({ type: 'system', text: `Cannot send DM: ${resolved.reason}. Use /peers to list resolvable keys.`, timestamp: Date.now() });
      }
      return;
    }

    broadcastToClients({ type: 'system', text: 'No recipient selected. Use @peer to DM, or /group peer1 peer2 to create a group tab.', timestamp: Date.now() });
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

    const expandedText = expandInlineRefs(text, configPeersWithSelf, seenKeyStore);
    const result = await relay.sendToRecipients([targetPeerKey], 'publish', { text: expandedText });

    if (!result.ok && result.errors.length > 0) {
      const peerName = peers.get(targetPeerKey) || ('@' + targetPeerKey.slice(-8));
      broadcastToClients({ type: 'system', text: `Failed to send to ${peerName}: ${result.errors[0].error}`, timestamp: Date.now() });
      return;
    }

    const dmMsg: Message = {
      from: ownDisplayName,
      fromKey: publicKey,
      text: compactInlineRefs(expandedText, configPeersWithSelf),
      timestamp: Date.now(),
      to: [targetPeerKey],
    };
    dmMsg.id = generateMessageId(dmMsg);
    messages.push(dmMsg);
    try { appendToConversation(dmMsg, conversationPath, configPeersWithSelf); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...dmMsg });
    suggestUnknownPeers([targetPeerKey]);
  };

  const handleGroupSend = async (text: string, recipients: string[]): Promise<void> => {
    try { appendToSent(text, sentPath); } catch { /* ignore */ }

    if (!relay.connected()) {
      broadcastToClients({ type: 'system', text: 'Not connected to relay', timestamp: Date.now() });
      return;
    }

    const resolvedBatch = resolveRecipientReferences(recipients, configPeersWithSelf, peers, seenKeyStore);
    const resolutionIssues = resolvedBatch.issues;
    const resolvedRecipients = resolvedBatch.recipients;

    // Normalize: exclude self, deduplicate, and sort for consistent grouping
    const uniqueRecipients = normalizeRecipientsForGrouping(resolvedRecipients, publicKey);

    for (const issue of resolutionIssues) {
      broadcastToClients({ type: 'system', text: `Group recipient issue: ${issue}`, timestamp: Date.now() });
    }

    if (uniqueRecipients.length === 0) {
      broadcastToClients({ type: 'system', text: 'Group has no valid recipients after resolution. Use /peers for exact keys.', timestamp: Date.now() });
      return;
    }

    const expandedText = expandInlineRefs(text, configPeersWithSelf, seenKeyStore);
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
      fromKey: publicKey,
      text: compactInlineRefs(expandedText, configPeersWithSelf),
      timestamp: Date.now(),
      to: uniqueRecipients,
    };
    groupMsg.id = generateMessageId(groupMsg);
    messages.push(groupMsg);
    try { appendToConversation(groupMsg, conversationPath, configPeersWithSelf); } catch { /* ignore */ }
    broadcastToClients({ type: 'message', ...groupMsg });
    suggestUnknownPeers(uniqueRecipients);
  };

  const handleGroupResolve = (text: string, ws: WebSocket): void => {
    const refs = text.slice('/group '.length).split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
    const batch = resolveRecipientReferences(refs, configPeersWithSelf, peers, seenKeyStore);
    const unresolved = batch.issues;
    // Normalize: exclude self, deduplicate, and sort
    const resolved = normalizeRecipientsForGrouping(batch.recipients, publicKey);

    for (const issue of unresolved) {
      ws.send(JSON.stringify({ type: 'system', text: `Group recipient issue: ${issue}`, timestamp: Date.now() }));
    }

    if (resolved.length === 0) {
      ws.send(JSON.stringify({ type: 'group_tab', recipients: [], error: 'No valid recipients for /group — check peer names are correct and online (see details above)' }));
    } else {
      // Compute display label on server side where we have configPeersWithSelf and can use shortenPeerId
      const label = resolved.map(key => shortenPeerId(key, configPeersWithSelf)).join(', ');
      ws.send(JSON.stringify({ type: 'group_tab', recipients: resolved, label }));
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
        '  /group <peer1 peer2 ...> — Create/switch a group tab (comma or space separated)',
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
