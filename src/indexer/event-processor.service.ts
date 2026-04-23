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
import {
  MetadataFetchResult,
  UnstoppableMetadataClient,
} from './unstoppable-metadata.client';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly validator: HiddenServiceValidatorService,
    private readonly metadataClient: UnstoppableMetadataClient,
    @InjectRepository(IndexerCheckpointEntity)
    private readonly checkpointRepo: Repository<IndexerCheckpointEntity>,
    @InjectRepository(HiddenServiceRecordEntity)
    private readonly recordRepo: Repository<HiddenServiceRecordEntity>,
  ) {}

  async process(event: DecodedUnsEvent): Promise<void> {
    // Fetch domain name outside the transaction so we don't hold a DB
    // connection open during an HTTP call.
    let metadataResult: MetadataFetchResult | null = null;
    if (event.name === 'Set') {
      const watchedKey = this.configService.get<string>(
        'WATCHED_UNS_KEY',
        'token.ANYONE.ANYONE.ANYONE.address',
      );
      if (event.key === watchedKey && this.validator.isValid(event.value)) {
        // tokenId -> name mappings are immutable, so once we've resolved a
        // name for a tokenId we never need to ask the metadata API again.
        const cached = await this.recordRepo.findOne({
          where: { tokenId: event.tokenId },
          select: { name: true },
        });

        if (cached?.name) {
          metadataResult = { status: 'resolved', name: cached.name };
        } else {
          metadataResult = await this.metadataClient.fetchDomainName(
            event.tokenId,
          );
          if (metadataResult.status === 'failed') {
            this.logger.warn(
              `Metadata fetch exhausted retries for tokenId ${event.tokenId} (${metadataResult.reason}); will be retried by backfill`,
            );
          }
        }
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
        this.logger.debug(
          `Skipping already processed log at tx ${event.transactionHash} log index ${event.logIndex}`,
        );
        return;
      }

      if (event.name === 'Set') {
        await this.applySetEvent(event, manager, metadataResult);
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

  async advanceCheckpoint(blockNumber: number): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.bumpCheckpoint(manager, blockNumber),
    );
  }

  private async applySetEvent(
    event: Extract<DecodedUnsEvent, { name: 'Set' }>,
    manager: DataSource['manager'],
    metadataResult: MetadataFetchResult | null,
  ): Promise<void> {
    const watchedKey = this.configService.get<string>(
      'WATCHED_UNS_KEY',
      'token.ANYONE.ANYONE.ANYONE.address',
    );

    if (event.key !== watchedKey) {
      this.logger.debug(
        `Ignoring Set event for unwatched key ${event.key} at tx ${event.transactionHash} log index ${event.logIndex}`,
      );
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

    const resolvedName =
      metadataResult?.status === 'resolved' ? metadataResult.name : null;
    const nameFetchFailedAt =
      metadataResult?.status === 'failed'
        ? new Date()
        : metadataResult?.status === 'resolved'
          ? null
          : (existing?.nameFetchFailedAt ?? null);

    const next = manager.create(HiddenServiceRecordEntity, {
      ...existing,
      tokenId: event.tokenId,
      value: event.value,
      name: resolvedName ?? existing?.name ?? null,
      nameFetchFailedAt,
      lastTransactionHash: event.transactionHash,
      lastBlockNumber: event.blockNumber,
      lastLogIndex: event.logIndex,
    });

    await manager.save(HiddenServiceRecordEntity, next);

    this.logger.log(
      `Processed Set event for tokenId ${event.tokenId} with value ${event.value} at tx ${event.transactionHash} log index ${event.logIndex}`,
    );
  }

  private async applyResetEvent(
    event: Extract<DecodedUnsEvent, { name: 'ResetRecords' }>,
    manager: DataSource['manager'],
  ): Promise<void> {
    const existing = await manager.findOne(HiddenServiceRecordEntity, {
      where: { tokenId: event.tokenId },
    });

    if (!existing) {
      this.logger.warn(
        `Received ResetRecords event for tokenId ${event.tokenId} with no existing record at tx ${event.transactionHash} log index ${event.logIndex}`,
      );
      return;
    }

    const next = manager.create(HiddenServiceRecordEntity, {
      ...existing,
      value: null,
      nameFetchFailedAt: null,
      lastTransactionHash: event.transactionHash,
      lastBlockNumber: event.blockNumber,
      lastLogIndex: event.logIndex,
    });

    await manager.save(HiddenServiceRecordEntity, next);

    this.logger.log(
      `Processed ResetRecords event for tokenId ${event.tokenId} at tx ${event.transactionHash} log index ${event.logIndex}`,
    );
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

    this.logger.log(
      `Advanced checkpoint to block ${next.lastProcessedBlock}`,
    );
  }
}
