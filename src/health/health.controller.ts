import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  INDEXER_CHECKPOINT_KEY,
  UNS_TOKEN_CHECKPOINT_KEY,
} from '../indexer/constants';
import { HiddenServiceRecordEntity } from '../indexer/entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from '../indexer/entities/indexer-checkpoint.entity';
import { UnsTokenEntity } from '../indexer/entities/uns-token.entity';
import { UnsTokenPendingResolutionEntity } from '../indexer/entities/uns-token-pending-resolution.entity';

@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(IndexerCheckpointEntity)
    private readonly checkpointRepo: Repository<IndexerCheckpointEntity>,
    @InjectRepository(HiddenServiceRecordEntity)
    private readonly recordRepo: Repository<HiddenServiceRecordEntity>,
    @InjectRepository(UnsTokenEntity)
    private readonly tokenRepo: Repository<UnsTokenEntity>,
    @InjectRepository(UnsTokenPendingResolutionEntity)
    private readonly pendingRepo: Repository<UnsTokenPendingResolutionEntity>,
  ) {}

  @Get()
  async getHealth(): Promise<Record<string, unknown>> {
    const [
      recordCheckpoint,
      tokenCheckpoint,
      recordCount,
      tokenCount,
      pendingTokenCount,
    ] = await Promise.all([
      this.checkpointRepo.findOne({
        where: { key: INDEXER_CHECKPOINT_KEY },
      }),
      this.checkpointRepo.findOne({
        where: { key: UNS_TOKEN_CHECKPOINT_KEY },
      }),
      this.recordRepo.count(),
      this.tokenRepo.count(),
      this.pendingRepo.count(),
    ]);

    return {
      ok: true,
      lastProcessedBlock: recordCheckpoint?.lastProcessedBlock ?? null,
      indexedRecords: recordCount,
      updatedAt: recordCheckpoint?.updatedAt ?? null,
      unsTokenCheckpoint: tokenCheckpoint?.lastProcessedBlock ?? null,
      unsTokenCount: tokenCount,
      unsTokenPendingCount: pendingTokenCount,
      unsTokenCheckpointUpdatedAt: tokenCheckpoint?.updatedAt ?? null,
    };
  }
}
