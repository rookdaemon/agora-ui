export interface Identity {
  publicKey: string;
  privateKey: string;
}

export interface AgoraConfig {
  identity: Identity;
  relay?: {
    url: string;
  };
}

export interface Message {
  from: string;
  text: string;
  timestamp: number;
  isDM?: boolean;
}

export interface PeerInfo {
  publicKey: string;
  name?: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
