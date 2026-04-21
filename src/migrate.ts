import { AppDataSource } from './data-source';

async function main() {
  await AppDataSource.initialize();
  console.log('Running migrations...');
  const migrations = await AppDataSource.runMigrations();
  if (migrations.length === 0) {
    console.log('No pending migrations.');
  } else {
    for (const migration of migrations) {
      console.log(`Applied: ${migration.name}`);
    }
  }
  await AppDataSource.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
