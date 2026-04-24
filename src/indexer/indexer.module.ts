import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HiddenServiceRecordEntity } from './entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from './entities/indexer-checkpoint.entity';
import { ProcessedLogEntity } from './entities/processed-log.entity';
import { UnsTokenEntity } from './entities/uns-token.entity';
import { UnsTokenPendingResolutionEntity } from './entities/uns-token-pending-resolution.entity';
import { EventProcessorService } from './event-processor.service';
import { HealingService } from './healing.service';
import { HiddenServiceValidatorService } from './hidden-service-validator.service';
import { MetadataBackfillService } from './metadata-backfill.service';
import { RealtimeIndexerService } from './realtime-indexer.service';
import { RpcEndpointManagerService } from './rpc/rpc-endpoint-manager.service';
import { UnsEventDecoderService } from './uns-event-decoder.service';
import { UnsTokenHealingService } from './uns-token-healing.service';
import { UnsTokenMetadataBackfillService } from './uns-token-metadata-backfill.service';
import { UnsTokenProcessorService } from './uns-token-processor.service';
import { UnstoppableMetadataClient } from './unstoppable-metadata.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HiddenServiceRecordEntity,
      IndexerCheckpointEntity,
      ProcessedLogEntity,
      UnsTokenEntity,
      UnsTokenPendingResolutionEntity,
    ]),
  ],
  providers: [
    UnsEventDecoderService,
    HiddenServiceValidatorService,
    UnstoppableMetadataClient,
    EventProcessorService,
    RpcEndpointManagerService,
    RealtimeIndexerService,
    HealingService,
    MetadataBackfillService,
    UnsTokenProcessorService,
    UnsTokenHealingService,
    UnsTokenMetadataBackfillService,
  ],
  exports: [EventProcessorService, UnsTokenProcessorService],
})
export class IndexerModule {}
