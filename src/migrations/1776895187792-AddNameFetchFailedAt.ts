import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNameFetchFailedAt1776895187792 implements MigrationInterface {
  name = 'AddNameFetchFailedAt1776895187792';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hidden_service_records" ADD "nameFetchFailedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hidden_service_records_name_fetch_failed_at" ON "hidden_service_records" ("nameFetchFailedAt") WHERE "nameFetchFailedAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hidden_service_records_name_fetch_failed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hidden_service_records" DROP COLUMN "nameFetchFailedAt"`,
    );
  }
}
