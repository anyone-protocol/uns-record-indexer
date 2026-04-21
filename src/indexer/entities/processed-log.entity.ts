import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('processed_logs')
@Unique(['transactionHash', 'logIndex'])
@Index(['blockNumber'])
export class ProcessedLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 66 })
  transactionHash!: string;

  @Column({ type: 'int' })
  logIndex!: number;

  @Column({ type: 'int' })
  transactionIndex!: number;

  @Column({ type: 'int' })
  blockNumber!: number;

  @Column({ type: 'varchar', length: 42 })
  contractAddress!: string;

  @Column({ type: 'varchar', length: 32 })
  eventName!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
