import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UNS_TOKEN_CHECKPOINT_KEY, ZERO_ADDRESS } from './constants';
import { IndexerCheckpointEntity } from './entities/indexer-checkpoint.entity';
import { ProcessedLogEntity } from './entities/processed-log.entity';
import { UnsTokenEntity } from './entities/uns-token.entity';
import { UnsTokenPendingResolutionEntity } from './entities/uns-token-pending-resolution.entity';
import { DecodedTransferEvent } from './types';
import {
  MetadataFetchResult,
  UnstoppableMetadataClient,
} from './unstoppable-metadata.client';

/**
 * Processes ERC-721 Transfer events on the UNS contract. Keeps its own
 * checkpoint (`UNS_TOKEN_CHECKPOINT_KEY`) so it can advance independently of
 * the record-event pipeline. Only tokens whose resolved domain name ends in
 * the required suffix are persisted; other tokens are silently skipped while
 * still recording a `processed_logs` row so they are never re-fetched.
 */
@Injectable()
export class UnsTokenProcessorService {
  private readonly logger = new Logger(UnsTokenProcessorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly metadataClient: UnstoppableMetadataClient,
    @InjectRepository(IndexerCheckpointEntity)
    private readonly checkpointRepo: Repository<IndexerCheckpointEntity>,
    @InjectRepository(UnsTokenEntity)
    private readonly tokenRepo: Repository<UnsTokenEntity>,
  ) {}

  async process(event: DecodedTransferEvent): Promise<void> {
    // If we've already accepted this token as a `.anyone` domain, skip the
    // metadata lookup — tokenId -> name is immutable.
    const existing = await this.tokenRepo.findOne({
      where: { tokenId: event.tokenId },
      select: { name: true },
    });

    let metadataResult: MetadataFetchResult | null = null;
    if (!existing) {
      metadataResult = await this.metadataClient.fetchDomainName(event.tokenId);
      if (metadataResult.status === 'failed') {
        this.logger.warn(
          `Metadata fetch exhausted retries for tokenId ${event.tokenId} (${metadataResult.reason}); will be retried by backfill`,
        );
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
          `Skipping already processed Transfer at tx ${event.transactionHash} log index ${event.logIndex}`,
        );
        return;
      }

      if (existing) {
        await this.upsertTrackedToken(event, existing.name, manager);
      } else {
        await this.applyFirstSighting(event, metadataResult!, manager);
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
      where: { key: UNS_TOKEN_CHECKPOINT_KEY },
    });

    return checkpoint?.lastProcessedBlock ?? startBlock;
  }

  async advanceCheckpoint(blockNumber: number): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.bumpCheckpoint(manager, blockNumber),
    );
  }

  private async applyFirstSighting(
    event: DecodedTransferEvent,
    metadataResult: MetadataFetchResult,
    manager: DataSource['manager'],
  ): Promise<void> {
    if (metadataResult.status === 'resolved') {
      const name = metadataResult.name ?? '';
      if (name && this.matchesRequiredSuffix(name)) {
        await this.insertTrackedToken(event, name, manager);
        await manager.delete(UnsTokenPendingResolutionEntity, {
          tokenId: event.tokenId,
        });
        this.logger.log(
          `Tracking new UNS token ${event.tokenId} (${name}) owner=${event.to} at tx ${event.transactionHash}`,
        );
        return;
      }

      // Resolved to a non-matching name (or null): drop any pending row and
      // stop tracking. The processed_logs row + checkpoint bump prevent any
      // future re-fetch for this log.
      await manager.delete(UnsTokenPendingResolutionEntity, {
        tokenId: event.tokenId,
      });
      this.logger.debug(
        `Ignoring non-matching UNS token ${event.tokenId} (name=${name || 'null'})`,
      );
      return;
    }

    // Metadata fetch failed — capture the latest observed state in the
    // pending table so the backfill job can retry later.
    await this.upsertPendingResolution(event, manager);
    this.logger.debug(
      `Queued pending resolution for tokenId ${event.tokenId} at tx ${event.transactionHash}`,
    );
  }

  private async insertTrackedToken(
    event: DecodedTransferEvent,
    name: string,
    manager: DataSource['manager'],
  ): Promise<void> {
    const row = manager.create(UnsTokenEntity, {
      tokenId: event.tokenId,
      name,
      owner: event.to,
      lastTransactionHash: event.transactionHash,
      lastBlockNumber: event.blockNumber,
      lastLogIndex: event.logIndex,
      lastTransactionIndex: event.transactionIndex,
      mintedAtBlock: event.from === ZERO_ADDRESS ? event.blockNumber : null,
    });
    await manager.save(UnsTokenEntity, row);
  }

  private async upsertTrackedToken(
    event: DecodedTransferEvent,
    cachedName: string,
    manager: DataSource['manager'],
  ): Promise<void> {
    const existing = await manager.findOne(UnsTokenEntity, {
      where: { tokenId: event.tokenId },
    });

    if (!existing) {
      // Race: the row was deleted between the pre-txn read and now. Re-insert
      // as a first sighting using the cached name.
      await this.insertTrackedToken(event, cachedName, manager);
      return;
    }

    // Guard against out-of-order delivery — only newer logs may overwrite
    // owner / last-seen pointers.
    if (!this.isNewerThan(event, existing)) {
      this.logger.debug(
        `Ignoring out-of-order Transfer for tokenId ${event.tokenId} at block ${event.blockNumber} log ${event.logIndex} (stored ${existing.lastBlockNumber}/${existing.lastLogIndex})`,
      );
      return;
    }

    existing.owner = event.to;
    existing.lastTransactionHash = event.transactionHash;
    existing.lastBlockNumber = event.blockNumber;
    existing.lastLogIndex = event.logIndex;
    existing.lastTransactionIndex = event.transactionIndex;
    if (event.from === ZERO_ADDRESS && existing.mintedAtBlock === null) {
      existing.mintedAtBlock = event.blockNumber;
    }
    await manager.save(UnsTokenEntity, existing);

    this.logger.log(
      `Updated UNS token ${event.tokenId} owner=${event.to} at tx ${event.transactionHash}`,
    );
  }

  private async upsertPendingResolution(
    event: DecodedTransferEvent,
    manager: DataSource['manager'],
  ): Promise<void> {
    const existing = await manager.findOne(UnsTokenPendingResolutionEntity, {
      where: { tokenId: event.tokenId },
    });

    if (existing && !this.isNewerThan(event, existing)) {
      existing.nameFetchFailedAt = new Date();
      await manager.save(UnsTokenPendingResolutionEntity, existing);
      return;
    }

    const row = manager.create(UnsTokenPendingResolutionEntity, {
      ...(existing ?? {}),
      tokenId: event.tokenId,
      owner: event.to,
      lastTransactionHash: event.transactionHash,
      lastBlockNumber: event.blockNumber,
      lastLogIndex: event.logIndex,
      lastTransactionIndex: event.transactionIndex,
      mintedAtBlock:
        event.from === ZERO_ADDRESS
          ? event.blockNumber
          : (existing?.mintedAtBlock ?? null),
      nameFetchFailedAt: new Date(),
    });
    await manager.save(UnsTokenPendingResolutionEntity, row);
  }

  private isNewerThan(
    event: DecodedTransferEvent,
    existing: { lastBlockNumber: number; lastLogIndex: number },
  ): boolean {
    if (event.blockNumber !== existing.lastBlockNumber) {
      return event.blockNumber > existing.lastBlockNumber;
    }
    return event.logIndex > existing.lastLogIndex;
  }

  private matchesRequiredSuffix(name: string): boolean {
    const suffix = this.configService.get<string>(
      'REQUIRED_VALUE_SUFFIX',
      '.anyone',
    );
    return name.toLowerCase().endsWith(suffix.toLowerCase());
  }

  private async bumpCheckpoint(
    manager: DataSource['manager'],
    blockNumber: number,
  ): Promise<void> {
    const checkpoint = await manager.findOne(IndexerCheckpointEntity, {
      where: { key: UNS_TOKEN_CHECKPOINT_KEY },
    });

    const next = manager.create(IndexerCheckpointEntity, {
      key: UNS_TOKEN_CHECKPOINT_KEY,
      lastProcessedBlock: Math.max(
        checkpoint?.lastProcessedBlock ?? 0,
        blockNumber,
      ),
    });

    await manager.save(IndexerCheckpointEntity, next);

    this.logger.debug(
      `Advanced UNS token checkpoint to block ${next.lastProcessedBlock}`,
    );
  }
}
