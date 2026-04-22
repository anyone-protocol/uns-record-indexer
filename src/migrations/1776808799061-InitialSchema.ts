import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1776808799061 implements MigrationInterface {
  name = 'InitialSchema1776808799061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "hidden_service_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tokenId" character varying(128) NOT NULL, "value" character varying(255), "name" character varying(253), "lastTransactionHash" character varying(66), "lastBlockNumber" integer NOT NULL DEFAULT '0', "lastLogIndex" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_bce724228fbdf6ac510f6a9e5d1" UNIQUE ("tokenId"), CONSTRAINT "PK_8e9f0494f7aeb665b9b5bf5cc8d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "indexer_checkpoints" ("key" character varying(128) NOT NULL, "lastProcessedBlock" integer NOT NULL DEFAULT '0', "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5ff7ace0bc649bbf6891387b61b" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "processed_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "transactionHash" character varying(66) NOT NULL, "logIndex" integer NOT NULL, "transactionIndex" integer NOT NULL, "blockNumber" integer NOT NULL, "contractAddress" character varying(42) NOT NULL, "eventName" character varying(32) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_4b1389f944521b12dc99633fab9" UNIQUE ("transactionHash", "logIndex"), CONSTRAINT "PK_fcb722d0dbf37ff193f4e9e7c39" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c0ebf3222e26edb0692be86e5" ON "processed_logs" ("blockNumber") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c0ebf3222e26edb0692be86e5"`,
    );
    await queryRunner.query(`DROP TABLE "processed_logs"`);
    await queryRunner.query(`DROP TABLE "indexer_checkpoints"`);
    await queryRunner.query(`DROP TABLE "hidden_service_records"`);
  }
}
