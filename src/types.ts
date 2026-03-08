import type { AgoraConfig as AgoraConfigLoaded } from '@rookdaemon/agora';
import type { InboundSecurityOptions } from './security.js';

export interface Identity {
  publicKey: string;
  privateKey: string;
}

export type AgoraConfig = Pick<AgoraConfigLoaded, 'identity' | 'peers'> & {
  relay?: {
    url: string;
  };
};

export interface Message {
  from: string;
  /** Sender public key when known; used for deterministic tab routing. */
  fromKey?: string;
  text: string;
  timestamp: number;
  /** Conversation partner public keys (for tab routing) */
  to?: string[];
}

export interface PeerInfo {
  publicKey: string;
  name?: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type SecurityOptions = InboundSecurityOptions;
