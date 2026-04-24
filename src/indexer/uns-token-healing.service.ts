import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonRpcProvider, Log } from 'ethers';
import { RpcEndpointManagerService } from './rpc/rpc-endpoint-manager.service';
import { classifyRpcError } from './rpc/rpc-error-classifier';
import { UnsEventDecoderService } from './uns-event-decoder.service';
import { UnsTokenProcessorService } from './uns-token-processor.service';

/**
 * Historical backfill for ERC-721 Transfer events on the UNS contract. Runs
 * alongside `HealingService` but keeps its own checkpoint
 * (`UNS_TOKEN_CHECKPOINT_KEY`) so the two pipelines can fall behind
 * independently without blocking each other. Shares the RPC endpoint manager
 * so provider failover and heal-back remain coordinated across the app.
 */
@Injectable()
export class UnsTokenHealingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnsTokenHealingService.name);
  private readonly providerCache = new Map<string, JsonRpcProvider>();
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private activeRun: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly decoder: UnsEventDecoderService,
    private readonly tokenProcessor: UnsTokenProcessorService,
    private readonly rpcManager: RpcEndpointManagerService,
  ) {}

  onModuleInit(): void {
    void this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activeRun) {
      await this.activeRun;
    }
    for (const provider of this.providerCache.values()) {
      provider.destroy();
    }
    this.providerCache.clear();
  }

  private async runLoop(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.activeRun = this.healMissedEvents();
    await this.activeRun;
    this.activeRun = null;

    if (!this.shuttingDown) {
      const intervalMs = this.getNumber(
        'UNS_TOKEN_HEALING_INTERVAL_MS',
        this.getNumber('HEALING_INTERVAL_MS', 300_000),
      );
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.runLoop();
      }, intervalMs);
    }
  }

  private getHttpProvider(): JsonRpcProvider | null {
    const endpoint = this.rpcManager.getActive('http');
    if (!endpoint) {
      return null;
    }
    let provider = this.providerCache.get(endpoint.url);
    if (!provider) {
      provider = new JsonRpcProvider(endpoint.url);
      this.providerCache.set(endpoint.url, provider);
    }
    return provider;
  }

  private async healMissedEvents(): Promise<void> {
    const unsAddress = this.configService.get<string>(
      'UNS_CONTRACT_ADDRESS',
      '',
    );

    if (!unsAddress) {
      this.logger.warn(
        'UNS token healing skipped: UNS_CONTRACT_ADDRESS is not set',
      );
      return;
    }

    const provider = this.getHttpProvider();
    if (!provider) {
      this.logger.warn(
        'UNS token healing skipped: no HTTP RPC endpoint configured',
      );
      return;
    }

    try {
      const confirmations = this.getNumber('BLOCK_CONFIRMATIONS', 12);
      const startBlock = this.getNumber(
        'UNS_TOKEN_START_BLOCK',
        this.getNumber('START_BLOCK', 0),
      );
      const chunkSize = this.getNumber(
        'UNS_TOKEN_HEALING_BLOCK_CHUNK_SIZE',
        this.getNumber('HEALING_BLOCK_CHUNK_SIZE', 2000),
      );
      const chunkDelayMs = this.getNumber(
        'UNS_TOKEN_HEALING_CHUNK_DELAY_MS',
        this.getNumber('HEALING_CHUNK_DELAY_MS', 250),
      );

      const latest = await this.callWithFailover((p) => p.getBlockNumber());
      const latestSafeBlock = Math.max(startBlock, latest - confirmations);
      const lastProcessed =
        await this.tokenProcessor.getLastProcessedBlock(startBlock);
      const fromBlock = Math.max(startBlock, lastProcessed + 1);

      this.logger.log(
        `UNS token healing cycle: fromBlock=${fromBlock} latestSafeBlock=${latestSafeBlock} lastProcessed=${lastProcessed}`,
      );

      if (fromBlock > latestSafeBlock) {
        this.logger.log('UNS token healing cycle: already caught up');
        return;
      }

      let totalLogs = 0;
      let first = true;
      for (
        let rangeStart = fromBlock;
        rangeStart <= latestSafeBlock;
        rangeStart += chunkSize
      ) {
        if (!first) {
          await this.sleep(chunkDelayMs);
        }
        first = false;

        const rangeEnd = Math.min(rangeStart + chunkSize - 1, latestSafeBlock);
        this.logger.debug(`Fetching Transfer logs ${rangeStart}-${rangeEnd}`);

        const logs = await this.fetchLogsWithRetry(
          unsAddress,
          rangeStart,
          rangeEnd,
          [this.decoder.getTransferEventTopic()],
        );

        totalLogs += logs.length;

        logs.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return a.blockNumber - b.blockNumber;
          }

          if (a.transactionIndex !== b.transactionIndex) {
            return a.transactionIndex - b.transactionIndex;
          }

          return a.index - b.index;
        });

        for (const log of logs) {
          const decoded = this.decoder.decode(log);
          if (!decoded || decoded.name !== 'Transfer') {
            continue;
          }
          await this.tokenProcessor.process(decoded);
        }

        // Advance the checkpoint to the end of this chunk even when no
        // matching events were found, so the next cycle doesn't re-scan
        // the same range.
        await this.tokenProcessor.advanceCheckpoint(rangeEnd);
      }

      this.logger.log(
        `UNS token healing cycle complete: processed ${totalLogs} Transfer log(s)`,
      );
    } catch (error) {
      this.logger.error('UNS token healing cycle failed', error as Error);
    }
  }

  private async callWithFailover<T>(
    fn: (provider: JsonRpcProvider) => Promise<T>,
  ): Promise<T> {
    const provider = this.getHttpProvider();
    if (!provider) {
      throw new Error('No HTTP RPC endpoint available');
    }
    try {
      const result = await fn(provider);
      this.rpcManager.reportSuccess('http');
      return result;
    } catch (error) {
      const reason = classifyRpcError(error);
      if (reason) {
        this.rpcManager.reportError('http', reason);
      }
      throw error;
    }
  }

  private async fetchLogsWithRetry(
    address: string,
    fromBlock: number,
    toBlock: number,
    topics: (string | string[] | null)[],
    attempt = 0,
  ): Promise<Log[]> {
    const maxRetries = 4;
    const baseDelayMs = 1000;

    try {
      return await this.callWithFailover((p) =>
        p.getLogs({
          address,
          fromBlock,
          toBlock,
          topics,
        }),
      );
    } catch (error) {
      if (this.isRangeTooLargeError(error) && fromBlock < toBlock) {
        const mid = Math.floor((fromBlock + toBlock) / 2);
        this.logger.warn(
          `Transfer block range ${fromBlock}-${toBlock} too large; splitting at ${mid}`,
        );
        const first = await this.fetchLogsWithRetry(
          address,
          fromBlock,
          mid,
          topics,
        );
        const second = await this.fetchLogsWithRetry(
          address,
          mid + 1,
          toBlock,
          topics,
        );
        return [...first, ...second];
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      const reason = classifyRpcError(error);
      const delay =
        reason === 'rate_limit'
          ? baseDelayMs * Math.pow(2, attempt)
          : baseDelayMs;

      this.logger.warn(
        `Transfer getLogs failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms: ${(error as Error).message}`,
      );
      await this.sleep(delay);
      return this.fetchLogsWithRetry(
        address,
        fromBlock,
        toBlock,
        topics,
        attempt + 1,
      );
    }
  }

  private isRangeTooLargeError(error: unknown): boolean {
    const msg = ((error as Error)?.message ?? '').toLowerCase();
    return (
      msg.includes('block range') ||
      msg.includes('query returned more than') ||
      msg.includes('10000 results') ||
      msg.includes('range too large')
    );
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
