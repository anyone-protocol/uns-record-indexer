import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { HiddenServiceRecordEntity } from '../indexer/entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from '../indexer/entities/indexer-checkpoint.entity';
import { UnsTokenEntity } from '../indexer/entities/uns-token.entity';
import { UnsTokenPendingResolutionEntity } from '../indexer/entities/uns-token-pending-resolution.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HiddenServiceRecordEntity,
      IndexerCheckpointEntity,
      UnsTokenEntity,
      UnsTokenPendingResolutionEntity,
    ]),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
