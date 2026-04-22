import { DataSource } from 'typeorm';
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

  await syncReadUser(AppDataSource);

  await AppDataSource.destroy();
  process.exit(0);
}

/**
 * Idempotently ensure a read-only PostgreSQL role exists with the given
 * password and has SELECT on all current and future tables in the public
 * schema. Runs on every migrate invocation so Vault password rotations
 * propagate on the next deploy.
 */
async function syncReadUser(dataSource: DataSource): Promise<void> {
  const user = process.env.DB_READ_USER;
  const password = process.env.DB_READ_PASSWORD;
  const database = process.env.DB_NAME ?? 'uns_indexer';

  if (!user || !password) {
    console.log(
      'DB_READ_USER/DB_READ_PASSWORD not set; skipping read-only user sync.',
    );
    return;
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(user)) {
    throw new Error(
      `Invalid DB_READ_USER "${user}": must match /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/`,
    );
  }

  const quotedUser = `"${user}"`;
  const quotedDatabase = `"${database.replace(/"/g, '""')}"`;
  const literalPassword = `'${password.replace(/'/g, "''")}'`;
  const literalUserName = `'${user.replace(/'/g, "''")}'`;

  const runner = dataSource.createQueryRunner();
  try {
    await runner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literalUserName}) THEN
           CREATE ROLE ${quotedUser} LOGIN PASSWORD ${literalPassword};
         ELSE
           ALTER ROLE ${quotedUser} WITH LOGIN PASSWORD ${literalPassword};
         END IF;
       END
       $$;`,
    );
    await runner.query(
      `GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedUser};`,
    );
    await runner.query(`GRANT USAGE ON SCHEMA public TO ${quotedUser};`);
    await runner.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${quotedUser};`,
    );
    await runner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${quotedUser};`,
    );
    console.log(`Synced read-only DB user: ${user}`);
  } finally {
    await runner.release();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
