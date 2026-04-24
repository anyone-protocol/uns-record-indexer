import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnsTokenTables1776996509170 implements MigrationInterface {
  name = 'AddUnsTokenTables1776996509170';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "uns_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tokenId" character varying(128) NOT NULL, "name" character varying(253) NOT NULL, "owner" character varying(42) NOT NULL, "lastTransactionHash" character varying(66) NOT NULL, "lastBlockNumber" integer NOT NULL DEFAULT '0', "lastLogIndex" integer NOT NULL DEFAULT '0', "lastTransactionIndex" integer NOT NULL DEFAULT '0', "mintedAtBlock" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_uns_tokens_token_id" UNIQUE ("tokenId"), CONSTRAINT "PK_uns_tokens" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_uns_tokens_owner" ON "uns_tokens" ("owner")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_uns_tokens_name" ON "uns_tokens" ("name")`,
    );
    await queryRunner.query(
      `CREATE TABLE "uns_token_pending_resolutions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tokenId" character varying(128) NOT NULL, "owner" character varying(42) NOT NULL, "lastTransactionHash" character varying(66) NOT NULL, "lastBlockNumber" integer NOT NULL DEFAULT '0', "lastLogIndex" integer NOT NULL DEFAULT '0', "lastTransactionIndex" integer NOT NULL DEFAULT '0', "mintedAtBlock" integer, "nameFetchFailedAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_uns_token_pending_resolutions_token_id" UNIQUE ("tokenId"), CONSTRAINT "PK_uns_token_pending_resolutions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_uns_token_pending_resolutions_name_fetch_failed_at" ON "uns_token_pending_resolutions" ("nameFetchFailedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_uns_token_pending_resolutions_name_fetch_failed_at"`,
    );
    await queryRunner.query(`DROP TABLE "uns_token_pending_resolutions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_uns_tokens_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_uns_tokens_owner"`);
    await queryRunner.query(`DROP TABLE "uns_tokens"`);
  }
}
