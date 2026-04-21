import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INDEXER_CHECKPOINT_KEY } from '../indexer/constants';
import { HiddenServiceRecordEntity } from '../indexer/entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from '../indexer/entities/indexer-checkpoint.entity';

@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(IndexerCheckpointEntity)
    private readonly checkpointRepo: Repository<IndexerCheckpointEntity>,
    @InjectRepository(HiddenServiceRecordEntity)
    private readonly recordRepo: Repository<HiddenServiceRecordEntity>,
  ) {}

  @Get()
  async getHealth(): Promise<Record<string, unknown>> {
    const checkpoint = await this.checkpointRepo.findOne({
      where: { key: INDEXER_CHECKPOINT_KEY },
    });
    const recordCount = await this.recordRepo.count();

    return {
      ok: true,
      lastProcessedBlock: checkpoint?.lastProcessedBlock ?? null,
      indexedRecords: recordCount,
      updatedAt: checkpoint?.updatedAt ?? null,
    };
  }
}
