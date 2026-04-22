import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MetadataFetchResult =
  | { status: 'resolved'; name: string | null }
  | { status: 'failed'; reason: string };

const RETRYABLE_STATUS_CODES = new Set([
  408, 418, 425, 429, 500, 502, 503, 504,
]);

@Injectable()
export class UnstoppableMetadataClient {
  private readonly logger = new Logger(UnstoppableMetadataClient.name);

  constructor(private readonly configService: ConfigService) {}

  async fetchDomainName(tokenId: string): Promise<MetadataFetchResult> {
    const maxAttempts = this.getNumber('METADATA_FETCH_MAX_ATTEMPTS', 4);
    const baseDelayMs = this.getNumber('METADATA_FETCH_BASE_DELAY_MS', 500);
    const timeoutMs = this.getNumber('METADATA_FETCH_TIMEOUT_MS', 5000);

    let lastReason = 'unknown';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const outcome = await this.attempt(tokenId, timeoutMs);

      if (outcome.kind === 'terminal') {
        return { status: 'resolved', name: outcome.name };
      }

      lastReason = outcome.reason;

      if (attempt === maxAttempts) {
        break;
      }

      const delay = this.computeDelay(
        baseDelayMs,
        attempt,
        outcome.retryAfterMs,
      );
      this.logger.warn(
        `Metadata fetch attempt ${attempt}/${maxAttempts} for tokenId ${tokenId} failed (${outcome.reason}); retrying in ${delay}ms`,
      );
      await this.sleep(delay);
    }

    return { status: 'failed', reason: lastReason };
  }

  private async attempt(
    tokenId: string,
    timeoutMs: number,
  ): Promise<
    | { kind: 'terminal'; name: string | null }
    | { kind: 'retryable'; reason: string; retryAfterMs?: number }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(
        `https://api.unstoppabledomains.com/metadata/${tokenId}`,
        { signal: controller.signal },
      );

      if (res.ok) {
        const body = (await res.json()) as { name?: string };
        return { kind: 'terminal', name: body.name ?? null };
      }

      if (res.status === 404) {
        return { kind: 'terminal', name: null };
      }

      if (RETRYABLE_STATUS_CODES.has(res.status)) {
        return {
          kind: 'retryable',
          reason: `HTTP ${res.status}`,
          retryAfterMs: this.parseRetryAfter(res.headers.get('retry-after')),
        };
      }

      this.logger.warn(
        `Metadata API returned non-retryable status ${res.status} for tokenId ${tokenId}`,
      );
      return { kind: 'terminal', name: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'retryable', reason: `network: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private computeDelay(
    baseDelayMs: number,
    attempt: number,
    retryAfterMs: number | undefined,
  ): number {
    const backoff = baseDelayMs * Math.pow(2, attempt - 1);
    return Math.max(backoff, retryAfterMs ?? 0);
  }

  private parseRetryAfter(header: string | null): number | undefined {
    if (!header) {
      return undefined;
    }

    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }

    return undefined;
  }

  private getNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
