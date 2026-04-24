import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ZERO_ADDRESS } from './constants';
import { UnsTokenEntity } from './entities/uns-token.entity';
import { UnsTokenPendingResolutionEntity } from './entities/uns-token-pending-resolution.entity';
import { UnstoppableMetadataClient } from './unstoppable-metadata.client';

/**
 * Periodically retries metadata lookups for UNS tokens whose first Transfer
 * sighting failed to resolve. Tokens whose resolved name matches the required
 * suffix are promoted into `uns_tokens`; non-matching tokens are dropped from
 * the pending table. On continued failure the `nameFetchFailedAt` marker is
 * bumped so the batch rotates.
 */
@Injectable()
export class UnsTokenMetadataBackfillService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UnsTokenMetadataBackfillService.name);
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private activeRun: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly metadataClient: UnstoppableMetadataClient,
    @InjectRepository(UnsTokenPendingResolutionEntity)
    private readonly pendingRepo: Repository<UnsTokenPendingResolutionEntity>,
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

    this.activeRun = this.backfillBatch();
    await this.activeRun;
    this.activeRun = null;

    if (!this.shuttingDown) {
      const intervalMs = this.getNumber(
        'UNS_TOKEN_BACKFILL_INTERVAL_MS',
        this.getNumber('METADATA_BACKFILL_INTERVAL_MS', 600_000),
      );
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.runLoop();
      }, intervalMs);
    }
  }

  private async backfillBatch(): Promise<void> {
    const batchSize = this.getNumber(
      'UNS_TOKEN_BACKFILL_BATCH_SIZE',
      this.getNumber('METADATA_BACKFILL_BATCH_SIZE', 25),
    );
    const requestDelayMs = this.getNumber(
      'UNS_TOKEN_BACKFILL_REQUEST_DELAY_MS',
      this.getNumber('METADATA_BACKFILL_REQUEST_DELAY_MS', 200),
    );

    let pending: UnsTokenPendingResolutionEntity[];
    try {
      pending = await this.pendingRepo.find({
        order: { nameFetchFailedAt: 'ASC' },
        take: batchSize,
      });
    } catch (error) {
      this.logger.error(
        'UNS token metadata backfill query failed',
        error as Error,
      );
      return;
    }

    if (pending.length === 0) {
      return;
    }

    this.logger.log(
      `UNS token metadata backfill: attempting ${pending.length} token(s)`,
    );

    let promoted = 0;
    let dropped = 0;
    let stillFailing = 0;

    for (const [index, row] of pending.entries()) {
      if (this.shuttingDown) {
        break;
      }
      if (index > 0) {
        await this.sleep(requestDelayMs);
      }

      try {
        const result = await this.metadataClient.fetchDomainName(row.tokenId);

        if (result.status === 'failed') {
          row.nameFetchFailedAt = new Date();
          await this.pendingRepo.save(row);
          stillFailing += 1;
          continue;
        }

        const name = result.name ?? '';
        if (name && this.matchesRequiredSuffix(name)) {
          await this.promote(row, name);
          promoted += 1;
        } else {
          await this.pendingRepo.delete({ id: row.id });
          dropped += 1;
        }
      } catch (error) {
        this.logger.warn(
          `UNS token metadata backfill error for tokenId ${row.tokenId}: ${(error as Error).message}`,
        );
        stillFailing += 1;
      }
    }

    this.logger.log(
      `UNS token metadata backfill complete: promoted=${promoted} dropped=${dropped} stillFailing=${stillFailing}`,
    );
  }

  private async promote(
    row: UnsTokenPendingResolutionEntity,
    name: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const tokenRepo = manager.getRepository(UnsTokenEntity);
      const existing = await tokenRepo.findOne({
        where: { tokenId: row.tokenId },
      });

      if (existing) {
        // A newer Transfer may have arrived and created the row already —
        // just drop the pending entry.
        await manager.delete(UnsTokenPendingResolutionEntity, { id: row.id });
        return;
      }

      const token = tokenRepo.create({
        tokenId: row.tokenId,
        name,
        owner: row.owner,
        lastTransactionHash: row.lastTransactionHash,
        lastBlockNumber: row.lastBlockNumber,
        lastLogIndex: row.lastLogIndex,
        lastTransactionIndex: row.lastTransactionIndex,
        mintedAtBlock:
          row.mintedAtBlock ??
          (row.owner !== ZERO_ADDRESS ? null : row.lastBlockNumber),
      });
      await tokenRepo.save(token);
      await manager.delete(UnsTokenPendingResolutionEntity, { id: row.id });
    });

    this.logger.log(
      `Promoted pending UNS token ${row.tokenId} (${name}) to tracked`,
    );
  }

  private matchesRequiredSuffix(name: string): boolean {
    const suffix = this.configService.get<string>(
      'REQUIRED_VALUE_SUFFIX',
      '.anyone',
    );
    return name.toLowerCase().endsWith(suffix.toLowerCase());
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
