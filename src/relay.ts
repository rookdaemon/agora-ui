import WebSocket from 'ws';
import type { RelayMessage, MessageEnvelope, ConnectionStatus } from './types.js';

export class RelayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private publicKey: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  
  onStatusChange?: (status: ConnectionStatus) => void;
  onMessage?: (from: string, envelope: MessageEnvelope) => void;
  onPeerOnline?: (publicKey: string) => void;
  onPeerOffline?: (publicKey: string) => void;
  onPeers?: (publicKeys: string[]) => void;
  onError?: (error: string) => void;

  constructor(url: string, publicKey: string) {
    this.url = url;
    this.publicKey = publicKey;
  }

  connect(): void {
    this.onStatusChange?.('connecting');
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.onStatusChange?.('connected');
      this.register();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as RelayMessage;
        this.handleMessage(message);
      } catch (error) {
        this.onError?.('Failed to parse relay message');
      }
    });

    this.ws.on('close', () => {
      this.onStatusChange?.('disconnected');
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connect();
        }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
      }
    });

    this.ws.on('error', (error) => {
      this.onStatusChange?.('error');
      this.onError?.(error.message || 'WebSocket error');
    });
  }

  private register(): void {
    const message: RelayMessage = {
      type: 'register',
      publicKey: this.publicKey
    };
    this.send(message);
  }

  private handleMessage(message: RelayMessage): void {
    switch (message.type) {
      case 'registered':
        // Handle initial peers list from registration
        if (message.peers && Array.isArray(message.peers)) {
          this.onPeers?.(message.peers);
        }
        break;
      case 'message':
        if (message.from && message.envelope) {
          this.onMessage?.(message.from, message.envelope);
        }
        break;
      case 'peer_online':
        if (message.publicKey) {
          this.onPeerOnline?.(message.publicKey);
        }
        break;
      case 'peer_offline':
        if (message.publicKey) {
          this.onPeerOffline?.(message.publicKey);
        }
        break;
      case 'error':
        this.onError?.(message.message || 'Unknown error');
        break;
    }
  }

  sendMessage(to: string, text: string): void {
    const message: RelayMessage = {
      type: 'message',
      to,
      envelope: {
        text,
        timestamp: Date.now()
      }
    };
    this.send(message);
  }

  private send(message: RelayMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
