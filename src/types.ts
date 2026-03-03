import type { AgoraConfig as AgoraConfigLoaded } from '@rookdaemon/agora';

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
  text: string;
  timestamp: number;
  isDM?: boolean;
  /** For DM messages: the other party's public key */
  peer?: string;
}

export interface PeerInfo {
  publicKey: string;
  name?: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SecurityOptions {
  rateLimitEnabled?: boolean;
  rateLimitMaxMessages?: number;
  rateLimitWindowMs?: number;
  envelopeDedupEnabled?: boolean;
  envelopeDedupMaxIds?: number;
  contentDedupEnabled?: boolean;
  contentDedupWindowMs?: number;
  ignoredPeers?: string[];
}
