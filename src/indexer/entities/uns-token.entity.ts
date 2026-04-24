import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('uns_tokens')
@Unique(['tokenId'])
@Index(['owner'])
@Index(['name'])
export class UnsTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tokenId!: string;

  @Column({ type: 'varchar', length: 253 })
  name!: string;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
