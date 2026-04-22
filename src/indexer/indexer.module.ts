import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HiddenServiceRecordEntity } from './entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from './entities/indexer-checkpoint.entity';
import { ProcessedLogEntity } from './entities/processed-log.entity';
import { EventProcessorService } from './event-processor.service';
import { HealingService } from './healing.service';
import { HiddenServiceValidatorService } from './hidden-service-validator.service';
import { RealtimeIndexerService } from './realtime-indexer.service';
import { RpcEndpointManagerService } from './rpc/rpc-endpoint-manager.service';
import { UnsEventDecoderService } from './uns-event-decoder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HiddenServiceRecordEntity,
      IndexerCheckpointEntity,
      ProcessedLogEntity,
    ]),
  ],
  providers: [
    UnsEventDecoderService,
    HiddenServiceValidatorService,
    EventProcessorService,
    RpcEndpointManagerService,
    RealtimeIndexerService,
    HealingService,
  ],
  exports: [EventProcessorService],
})
export class IndexerModule {}
