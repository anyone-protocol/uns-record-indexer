import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('hidden_service_records')
@Unique(['tokenId'])
export class HiddenServiceRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tokenId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  value!: string | null;

  @Column({ type: 'varchar', length: 253, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 66, nullable: true })
  lastTransactionHash!: string | null;

  @Column({ type: 'int', default: 0 })
  lastBlockNumber!: number;

  @Column({ type: 'int', default: 0 })
  lastLogIndex!: number;

  @Column({ type: 'timestamp', nullable: true })
  nameFetchFailedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
