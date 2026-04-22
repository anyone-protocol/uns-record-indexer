import { RpcFailureReason } from './rpc-endpoint.types';

export function isRateLimitError(error: unknown): boolean {
  const msg = ((error as Error)?.message ?? '').toLowerCase();
  const status = (error as { status?: number })?.status;
  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

export function isServerError(error: unknown): boolean {
  const msg = ((error as Error)?.message ?? '').toLowerCase();
  const status = (error as { status?: number })?.status;
  const code = (error as { code?: string })?.code;

  if (typeof status === 'number' && status >= 500 && status < 600) {
    return true;
  }

  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  ) {
    return true;
  }

  return (
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('internal server error') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout')
  );
}

export function isTimeoutError(error: unknown): boolean {
  const msg = ((error as Error)?.message ?? '').toLowerCase();
  const code = (error as { code?: string })?.code;
  return (
    code === 'ETIMEDOUT' ||
    code === 'TIMEOUT' ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  );
}

export function classifyRpcError(error: unknown): RpcFailureReason | null {
  if (isRateLimitError(error)) {
    return 'rate_limit';
  }
  if (isServerError(error)) {
    return 'server_error';
  }
  if (isTimeoutError(error)) {
    return 'timeout';
  }
  return null;
}
