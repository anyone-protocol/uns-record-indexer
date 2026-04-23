import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonRpcProvider, Log } from 'ethers';
import { EventProcessorService } from './event-processor.service';
import { RpcEndpointManagerService } from './rpc/rpc-endpoint-manager.service';
import { classifyRpcError } from './rpc/rpc-error-classifier';
import { UnsEventDecoderService } from './uns-event-decoder.service';

@Injectable()
export class HealingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealingService.name);
  private readonly providerCache = new Map<string, JsonRpcProvider>();
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private activeRun: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly decoder: UnsEventDecoderService,
    private readonly eventProcessor: EventProcessorService,
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
      const intervalMs = Number(
        this.configService.get<string>('HEALING_INTERVAL_MS', '300000'),
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
      this.logger.warn('Healing skipped: UNS_CONTRACT_ADDRESS is not set');
      return;
    }

    const provider = this.getHttpProvider();
    if (!provider) {
      this.logger.warn(
        'Healing skipped: no HTTP RPC endpoint configured (INFURA_HTTP_RPC_URL / ALCHEMY_HTTP_RPC_URL)',
      );
      return;
    }

    try {
      const confirmations = Number(
        this.configService.get<string>('BLOCK_CONFIRMATIONS', '12'),
      );
      const startBlock = Number(
        this.configService.get<string>('START_BLOCK', '0'),
      );
      const chunkSize = Number(
        this.configService.get<string>('HEALING_BLOCK_CHUNK_SIZE', '2000'),
      );
      const chunkDelayMs = Number(
        this.configService.get<string>('HEALING_CHUNK_DELAY_MS', '250'),
      );
      const watchedKey = this.configService.get<string>(
        'WATCHED_UNS_KEY',
        'token.ANYONE.ANYONE.ANYONE.address',
      );
      const keyIndexTopic = this.decoder.getKeyIndexTopic(watchedKey);

      const latest = await this.callWithFailover((p) => p.getBlockNumber());
      const latestSafeBlock = Math.max(startBlock, latest - confirmations);
      const lastProcessed =
        await this.eventProcessor.getLastProcessedBlock(startBlock);
      const fromBlock = Math.max(startBlock, lastProcessed + 1);

      this.logger.log(
        `Healing cycle: fromBlock=${fromBlock} latestSafeBlock=${latestSafeBlock} lastProcessed=${lastProcessed}`,
      );

      if (fromBlock > latestSafeBlock) {
        this.logger.log('Healing cycle: already caught up, nothing to do');
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
        this.logger.debug(`Fetching logs ${rangeStart}-${rangeEnd}`);

        // `Set` has 4 topics and `ResetRecords` has 2, so they can't share
        // a single filter. Fetch them separately — `Set` is narrowed to
        // the watched key via the indexed `keyIndex` topic hash, which
        // lets the RPC provider discard unrelated record keys server-side.
        const [setLogs, resetLogs] = await Promise.all([
          this.fetchLogsWithRetry(unsAddress, rangeStart, rangeEnd, [
            this.decoder.getSetEventTopic(),
            null,
            keyIndexTopic,
          ]),
          this.fetchLogsWithRetry(unsAddress, rangeStart, rangeEnd, [
            this.decoder.getResetRecordsEventTopic(),
          ]),
        ]);
        const logs = [...setLogs, ...resetLogs];

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
          if (!decoded) {
            continue;
          }
          await this.eventProcessor.process(decoded);
        }

        // Advance the checkpoint to the end of this chunk even when no
        // matching events were found, so the next cycle doesn't re-scan
        // the same range.
        await this.eventProcessor.advanceCheckpoint(rangeEnd);
      }

      this.logger.log(`Healing cycle complete: processed ${totalLogs} log(s)`);
    } catch (error) {
      this.logger.error('Healing cycle failed', error as Error);
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
          `Block range ${fromBlock}-${toBlock} too large; splitting at ${mid}`,
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
        `getLogs failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms: ${(error as Error).message}`,
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
