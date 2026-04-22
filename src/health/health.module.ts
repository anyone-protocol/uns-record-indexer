import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { HiddenServiceRecordEntity } from '../indexer/entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from '../indexer/entities/indexer-checkpoint.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HiddenServiceRecordEntity,
      IndexerCheckpointEntity,
    ]),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
