export type RpcProviderName = 'infura' | 'alchemy';

export type RpcTransport = 'ws' | 'http';

export type RpcEndpoint = {
  name: RpcProviderName;
  url: string;
};

export type RpcFailureReason =
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'ws_error'
  | 'threshold';

export const HARD_ROTATE_REASONS: ReadonlySet<RpcFailureReason> = new Set([
  'rate_limit',
  'ws_error',
]);
