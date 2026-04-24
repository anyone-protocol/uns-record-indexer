import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Holds UNS tokens whose domain name couldn't be resolved when their Transfer
 * event was first processed. The backfill service periodically retries these
 * rows: if the resolved name ends in the required suffix they are promoted
 * into `uns_tokens`; otherwise the row is dropped.
 */
@Entity('uns_token_pending_resolutions')
@Unique(['tokenId'])
@Index(['nameFetchFailedAt'])
export class UnsTokenPendingResolutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tokenId!: string;

  @Column({ type: 'varchar', length: 42 })
  owner!: string;

  @Column({ type: 'varchar', length: 66 })
  lastTransactionHash!: string;

  @Column({ type: 'int', default: 0 })
  lastBlockNumber!: number;

  @Column({ type: 'int', default: 0 })
  lastLogIndex!: number;

  @Column({ type: 'int', default: 0 })
  lastTransactionIndex!: number;

  @Column({ type: 'int', nullable: true })
  mintedAtBlock!: number | null;

  @Column({ type: 'timestamp' })
  nameFetchFailedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
