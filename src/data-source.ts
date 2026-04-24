import * as path from 'path';
import { DataSource } from 'typeorm';
import { HiddenServiceRecordEntity } from './indexer/entities/hidden-service-record.entity';
import { IndexerCheckpointEntity } from './indexer/entities/indexer-checkpoint.entity';
import { ProcessedLogEntity } from './indexer/entities/processed-log.entity';
import { UnsTokenEntity } from './indexer/entities/uns-token.entity';
import { UnsTokenPendingResolutionEntity } from './indexer/entities/uns-token-pending-resolution.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? '5432'),
  username: process.env.DB_USER ?? 'postgres',
  password: encodeURIComponent(process.env.DB_PASSWORD ?? 'postgres'),
  database: process.env.DB_NAME ?? 'uns_indexer',
  entities: [
    HiddenServiceRecordEntity,
    IndexerCheckpointEntity,
    ProcessedLogEntity,
    UnsTokenEntity,
    UnsTokenPendingResolutionEntity,
  ],
  // __dirname resolves to src/ under ts-node (CLI) and dist/ under node (Docker)
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',
});
