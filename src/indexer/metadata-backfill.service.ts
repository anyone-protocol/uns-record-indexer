import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { HiddenServiceRecordEntity } from './entities/hidden-service-record.entity';
import { UnstoppableMetadataClient } from './unstoppable-metadata.client';

@Injectable()
export class MetadataBackfillService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetadataBackfillService.name);
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private activeRun: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly metadataClient: UnstoppableMetadataClient,
    @InjectRepository(HiddenServiceRecordEntity)
    private readonly recordRepo: Repository<HiddenServiceRecordEntity>,
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
        'METADATA_BACKFILL_INTERVAL_MS',
        600_000,
      );
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.runLoop();
      }, intervalMs);
    }
  }

  private async backfillBatch(): Promise<void> {
    const batchSize = this.getNumber('METADATA_BACKFILL_BATCH_SIZE', 25);
    const requestDelayMs = this.getNumber(
      'METADATA_BACKFILL_REQUEST_DELAY_MS',
      200,
    );

    let pending: HiddenServiceRecordEntity[];
    try {
      pending = await this.recordRepo.find({
        where: {
          value: Not(IsNull()),
          name: IsNull(),
          nameFetchFailedAt: Not(IsNull()),
        },
        order: { nameFetchFailedAt: 'ASC' },
        take: batchSize,
      });
    } catch (error) {
      this.logger.error('Metadata backfill query failed', error as Error);
      return;
    }

    if (pending.length === 0) {
      return;
    }

    this.logger.log(
      `Metadata backfill: attempting ${pending.length} record(s)`,
    );

    let resolved = 0;
    let stillFailing = 0;

    for (const [index, record] of pending.entries()) {
      if (this.shuttingDown) {
        break;
      }
      if (index > 0) {
        await this.sleep(requestDelayMs);
      }

      try {
        const result = await this.metadataClient.fetchDomainName(
          record.tokenId,
        );

        if (result.status === 'resolved') {
          record.name = result.name;
          record.nameFetchFailedAt = null;
          await this.recordRepo.save(record);
          resolved += 1;
        } else {
          record.nameFetchFailedAt = new Date();
          await this.recordRepo.save(record);
          stillFailing += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Metadata backfill error for tokenId ${record.tokenId}: ${(error as Error).message}`,
        );
        stillFailing += 1;
      }
    }

    this.logger.log(
      `Metadata backfill complete: resolved=${resolved} stillFailing=${stillFailing}`,
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
