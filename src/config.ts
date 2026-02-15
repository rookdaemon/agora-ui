import { loadAgoraConfig, getDefaultConfigPath } from '@rookdaemon/agora';
import type { AgoraConfig as AgoraConfigLoaded } from '@rookdaemon/agora';

/** Config shape used by the UI (identity + optional relay URL). */
export type AgoraConfig = Pick<AgoraConfigLoaded, 'identity'> & {
  relay?: { url: string };
};

/**
 * Load Agora config using canonical loader from @rookdaemon/agora.
 */
export function loadConfig(configPath?: string): AgoraConfig & { identity: { publicKey: string; privateKey: string } } {
  const path = configPath ?? getDefaultConfigPath();
  const config = loadAgoraConfig(path);
  return {
    identity: config.identity,
    relay: config.relay ? { url: config.relay.url } : undefined,
  };
}

export function getRelayUrl(config: AgoraConfig, cliRelay?: string): string {
  if (cliRelay) {
    return cliRelay;
  }
  if (config.relay?.url) {
    return config.relay.url;
  }
  return 'wss://agora-relay.lbsa71.net';
}
