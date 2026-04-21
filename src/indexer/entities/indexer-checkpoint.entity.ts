import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('indexer_checkpoints')
export class IndexerCheckpointEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ type: 'int', default: 0 })
  lastProcessedBlock!: number;

  @UpdateDateColumn()
  updatedAt!: Date;
}
