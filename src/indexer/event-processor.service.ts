import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { INDEXER_CHECKPOINT_KEY } from './constants';
import { HiddenServiceValidatorService } from './hidden-service-validator.service';
import { HiddenServiceRecordEntity } from './entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from './entities/indexer-checkpoint.entity';
import { ProcessedLogEntity } from './entities/processed-log.entity';
import { DecodedUnsEvent } from './types';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly validator: HiddenServiceValidatorService,
    @InjectRepository(IndexerCheckpointEntity)
    private readonly checkpointRepo: Repository<IndexerCheckpointEntity>,
  ) {}

  async process(event: DecodedUnsEvent): Promise<void> {
    // Fetch domain name outside the transaction so we don't hold a DB
    // connection open during an HTTP call.
    let domainName: string | null = null;
    if (event.name === 'Set') {
      const watchedKey = this.configService.get<string>(
        'WATCHED_UNS_KEY',
        'token.ANYONE.ANYONE.ANYONE.address',
      );
      if (event.key === watchedKey && this.validator.isValid(event.value)) {
        domainName = await this.fetchDomainName(event.tokenId);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const processed = await manager.findOne(ProcessedLogEntity, {
        where: {
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
        },
      });

      if (processed) {
        return;
      }

      if (event.name === 'Set') {
        await this.applySetEvent(event, manager, domainName);
      }

      if (event.name === 'ResetRecords') {
        await this.applyResetEvent(event, manager);
      }

      await manager.save(ProcessedLogEntity, {
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        transactionIndex: event.transactionIndex,
        blockNumber: event.blockNumber,
        contractAddress: event.address,
        eventName: event.name,
      });

      await this.bumpCheckpoint(manager, event.blockNumber);
    });
  }

  async getLastProcessedBlock(startBlock: number): Promise<number> {
    const checkpoint = await this.checkpointRepo.findOne({
      where: { key: INDEXER_CHECKPOINT_KEY },
    });

    return checkpoint?.lastProcessedBlock ?? startBlock;
  }

  private async applySetEvent(
    event: Extract<DecodedUnsEvent, { name: 'Set' }>,
    manager: DataSource['manager'],
    domainName: string | null,
  ): Promise<void> {
    const watchedKey = this.configService.get<string>(
      'WATCHED_UNS_KEY',
      'token.ANYONE.ANYONE.ANYONE.address',
    );

    if (event.key !== watchedKey) {
      return;
    }

    if (!this.validator.isValid(event.value)) {
      this.logger.warn(
        `Ignoring invalid hidden service value for token ${event.tokenId} with value ${event.value} at tx ${event.transactionHash} log index ${event.logIndex}`,
      );
      return;
    }

    const existing = await manager.findOne(HiddenServiceRecordEntity, {
      where: { tokenId: event.tokenId },
    });

    const next = manager.create(HiddenServiceRecordEntity, {
      ...existing,
      tokenId: event.tokenId,
      value: event.value,
      name: domainName ?? existing?.name ?? null,
      lastTransactionHash: event.transactionHash,
      lastBlockNumber: event.blockNumber,
      lastLogIndex: event.logIndex,
    });

    await manager.save(HiddenServiceRecordEntity, next);
  }

  private async applyResetEvent(
    event: Extract<DecodedUnsEvent, { name: 'ResetRecords' }>,
    manager: DataSource['manager'],
  ): Promise<void> {
    const existing = await manager.findOne(HiddenServiceRecordEntity, {
      where: { tokenId: event.tokenId },
    });

    if (!existing) {
      return;
    }

    const next = manager.create(HiddenServiceRecordEntity, {
      ...existing,
      value: null,
      lastTransactionHash: event.transactionHash,
      lastBlockNumber: event.blockNumber,
      lastLogIndex: event.logIndex,
    });

    await manager.save(HiddenServiceRecordEntity, next);
  }

  private async fetchDomainName(tokenId: string): Promise<string | null> {
    try {
      const res = await fetch(
        `https://api.unstoppabledomains.com/metadata/${tokenId}`,
      );
      if (!res.ok) {
        this.logger.warn(
          `Metadata API returned ${res.status} for tokenId ${tokenId}`,
        );
        return null;
      }
      const body = await res.json() as { name?: string };
      return body.name ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch domain name for tokenId ${tokenId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async bumpCheckpoint(
    manager: DataSource['manager'],
    blockNumber: number,
  ): Promise<void> {
    const checkpoint = await manager.findOne(IndexerCheckpointEntity, {
      where: { key: INDEXER_CHECKPOINT_KEY },
    });

    const next = manager.create(IndexerCheckpointEntity, {
      key: INDEXER_CHECKPOINT_KEY,
      lastProcessedBlock: Math.max(
        checkpoint?.lastProcessedBlock ?? 0,
        blockNumber,
      ),
    });

    await manager.save(IndexerCheckpointEntity, next);
  }
}
