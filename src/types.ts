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

export interface RelayMessage {
  type: 'register' | 'registered' | 'message' | 'error' | 'peer_online' | 'peer_offline';
  publicKey?: string;
  to?: string;
  from?: string;
  envelope?: MessageEnvelope;
  code?: string;
  message?: string;
  peers?: string[];
}

export interface MessageEnvelope {
  text: string;
  timestamp: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
