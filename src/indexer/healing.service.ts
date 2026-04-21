import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonRpcProvider, Log } from 'ethers';
import { EventProcessorService } from './event-processor.service';
import { UnsEventDecoderService } from './uns-event-decoder.service';

@Injectable()
export class HealingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealingService.name);
  private provider: JsonRpcProvider | null = null;
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private activeRun: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly decoder: UnsEventDecoderService,
    private readonly eventProcessor: EventProcessorService,
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

  private async healMissedEvents(): Promise<void> {
    const httpRpcUrl = this.configService.get<string>('INFURA_HTTP_RPC_URL', '');
    const unsAddress = this.configService.get<string>('UNS_CONTRACT_ADDRESS', '');

    if (!httpRpcUrl || !unsAddress) {
      this.logger.warn(
        `Healing skipped: ${!httpRpcUrl ? 'INFURA_HTTP_RPC_URL' : 'UNS_CONTRACT_ADDRESS'} is not set`,
      );
      return;
    }

    if (!this.provider) {
      this.provider = new JsonRpcProvider(httpRpcUrl);
    }

    try {
      const confirmations = Number(this.configService.get<string>('BLOCK_CONFIRMATIONS', '12'));
      const startBlock = Number(this.configService.get<string>('START_BLOCK', '0'));
      const chunkSize = Number(this.configService.get<string>('HEALING_BLOCK_CHUNK_SIZE', '2000'));
      const chunkDelayMs = Number(this.configService.get<string>('HEALING_CHUNK_DELAY_MS', '250'));

      const latest = await this.provider.getBlockNumber();
      const latestSafeBlock = Math.max(startBlock, latest - confirmations);
      const lastProcessed = await this.eventProcessor.getLastProcessedBlock(startBlock);
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

        const logs = await this.fetchLogsWithRetry(
          unsAddress,
          rangeStart,
          rangeEnd,
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
          if (!decoded) {
            continue;
          }
          await this.eventProcessor.process(decoded);
        }
      }

      this.logger.log(`Healing cycle complete: processed ${totalLogs} log(s)`);
    } catch (error) {
      this.logger.error('Healing cycle failed', error as Error);
    }
  }

  private async fetchLogsWithRetry(
    address: string,
    fromBlock: number,
    toBlock: number,
    attempt = 0,
  ): Promise<Log[]> {
    const maxRetries = 4;
    const baseDelayMs = 1000;

    try {
      return await this.provider!.getLogs({
        address,
        fromBlock,
        toBlock,
        topics: [this.decoder.getEventTopics()],
      });
    } catch (error) {
      if (this.isRangeTooLargeError(error) && fromBlock < toBlock) {
        const mid = Math.floor((fromBlock + toBlock) / 2);
        this.logger.warn(
          `Block range ${fromBlock}-${toBlock} too large; splitting at ${mid}`,
        );
        const first = await this.fetchLogsWithRetry(address, fromBlock, mid);
        const second = await this.fetchLogsWithRetry(address, mid + 1, toBlock);
        return [...first, ...second];
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      const delay = this.isRateLimitError(error)
        ? baseDelayMs * Math.pow(2, attempt)
        : baseDelayMs;

      this.logger.warn(
        `getLogs failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms: ${(error as Error).message}`,
      );
      await this.sleep(delay);
      return this.fetchLogsWithRetry(address, fromBlock, toBlock, attempt + 1);
    }
  }

  private isRateLimitError(error: unknown): boolean {
    const msg = ((error as Error)?.message ?? '').toLowerCase();
    const status = (error as { status?: number })?.status;
    return (
      status === 429 ||
      msg.includes('rate limit') ||
      msg.includes('too many requests')
    );
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
