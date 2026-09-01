import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, type PoolClient, type PoolConfig } from 'pg';

config({ path: resolve(__dirname, '../../.env') });

const PROJECT_ROOT = resolve(__dirname, '../..');
const APP_SCHEMA = 'public';
const VECTOR_TABLE = 'AssetEmbedding';
const MIGRATIONS_TABLE = '_prisma_migrations';

type CliOptions = {
  dryRun: boolean;
  force: boolean;
  batchSize: number;
};

type ColumnMeta = {
  name: string;
  dataType: string;
  udtName: string;
};

type TablePlan = {
  name: string;
  columns: ColumnMeta[];
  sourceRows: number;
  sourceVectors: number | null;
};

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let force = false;
  let batchSize = 100;

  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--force') force = true;
    else if (arg.startsWith('--batch-size=')) {
      const parsed = Number(arg.slice('--batch-size='.length));
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid --batch-size value: ${arg}`);
      }
      batchSize = parsed;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, force, batchSize };
}

function printUsage(): void {
  console.log(`
Migrate the current Postgres database (schema + rows + pgvector embeddings)
to TARGET_DATABASE_URL in a single data transaction.

Usage:
  npm run db:migrate-to-rds -- [--dry-run] [--force] [--batch-size=100]

Environment:
  DATABASE_URL          Source database (current)
  TARGET_DATABASE_URL   Destination RDS database

Flags:
  --dry-run       Plan and count only; do not write
  --force         Allow replacing existing destination rows (truncate is transactional)
  --batch-size=N  Insert batch size (default 100; embeddings use min(N, 25))
`);
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete('schema');
  return url.toString();
}

function identityKey(raw: string): string {
  const url = new URL(raw);
  const db = url.pathname.replace(/^\//, '');
  return `${url.hostname}:${url.port || '5432'}/${db}`;
}

function createPool(connectionString: string): Pool {
  const parsed = new URL(connectionString);
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  const sslDisabled = process.env.DATABASE_SSL === 'false';
  const poolConfig: PoolConfig = {
    connectionString,
    max: 2,
    connectionTimeoutMillis: 30_000,
  };
  if (!isLocal && !sslDisabled) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  return new Pool(poolConfig);
}

async function listAppTables(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ tablename: string }>(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = $1
        AND tablename <> $2
      ORDER BY tablename
    `,
    [APP_SCHEMA, MIGRATIONS_TABLE],
  );
  return result.rows.map((row) => row.tablename);
}

async function topologicalTableOrder(
  client: PoolClient,
  tables: string[],
): Promise<string[]> {
  const tableSet = new Set(tables);
  const inbound = new Map<string, Set<string>>();
  for (const table of tables) inbound.set(table, new Set());

  const fks = await client.query<{
    child: string;
    parent: string;
  }>(
    `
      SELECT
        child_ns.relname AS child,
        parent_ns.relname AS parent
      FROM pg_constraint con
      JOIN pg_class child_ns ON child_ns.oid = con.conrelid
      JOIN pg_class parent_ns ON parent_ns.oid = con.confrelid
      JOIN pg_namespace nsp ON nsp.oid = child_ns.relnamespace
      WHERE con.contype = 'f'
        AND nsp.nspname = $1
    `,
    [APP_SCHEMA],
  );

  for (const row of fks.rows) {
    if (!tableSet.has(row.child) || !tableSet.has(row.parent)) continue;
    if (row.child === row.parent) continue;
    inbound.get(row.child)?.add(row.parent);
  }

  const remaining = new Set(tables);
  const ordered: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => {
      const parents = inbound.get(table);
      return !parents || [...parents].every((parent) => !remaining.has(parent));
    });

    if (ready.length === 0) {
      throw new Error(
        `Circular foreign keys prevent a safe copy order: ${[...remaining].join(', ')}`,
      );
    }

    ready.sort((a, b) => a.localeCompare(b));
    for (const table of ready) {
      remaining.delete(table);
      ordered.push(table);
    }
  }

  return ordered;
}

async function describeColumns(
  client: PoolClient,
  table: string,
): Promise<ColumnMeta[]> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
  }>(
    `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `,
    [APP_SCHEMA, table],
  );

  return result.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    udtName: row.udt_name,
  }));
}

async function countRows(client: PoolClient, table: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${quoteIdent(table)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countVectors(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "AssetEmbedding" WHERE vector IS NOT NULL`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function isJsonColumn(column: ColumnMeta): boolean {
  return column.udtName === 'json' || column.udtName === 'jsonb';
}

function selectSql(table: string, columns: ColumnMeta[]): string {
  const projections = columns.map((column) => {
    const ident = quoteIdent(column.name);
    if (column.udtName === 'vector' || isJsonColumn(column)) {
      return `${ident}::text AS ${ident}`;
    }
    return ident;
  });
  return `SELECT ${projections.join(', ')} FROM ${quoteIdent(table)}`;
}

function insertSql(table: string, columns: ColumnMeta[], rowCount: number): string {
  const colList = columns.map((column) => quoteIdent(column.name)).join(', ');
  const rowPlaceholders: string[] = [];
  let param = 1;

  for (let row = 0; row < rowCount; row += 1) {
    const cells = columns.map((column) => {
      const placeholder = `$${param}`;
      param += 1;
      if (column.udtName === 'vector') {
        return `${placeholder}::vector`;
      }
      if (isJsonColumn(column)) {
        return `${placeholder}::${column.udtName}`;
      }
      return placeholder;
    });
    rowPlaceholders.push(`(${cells.join(', ')})`);
  }

  return `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${rowPlaceholders.join(', ')}`;
}

function serializeValue(value: unknown, column: ColumnMeta): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (isJsonColumn(column)) {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return value;
}

function flattenRows(
  rows: Record<string, unknown>[],
  columns: ColumnMeta[],
): unknown[] {
  const values: unknown[] = [];
  for (const row of rows) {
    for (const column of columns) {
      values.push(serializeValue(row[column.name], column));
    }
  }
  return values;
}

type LocalMigration = {
  name: string;
  sql: string;
  checksum: string;
};

function listLocalMigrations(): LocalMigration[] {
  const migrationsDir = resolve(PROJECT_ROOT, 'prisma/migrations');
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const sqlPath = resolve(migrationsDir, name, 'migration.sql');
      const sql = readFileSync(sqlPath);
      return {
        name,
        sql: sql.toString('utf8'),
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(MIGRATIONS_TABLE)} (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function appliedMigrationNames(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ migration_name: string }>(
    `
      SELECT "migration_name"
      FROM ${quoteIdent(MIGRATIONS_TABLE)}
      WHERE "rolled_back_at" IS NULL
    `,
  );
  return new Set(result.rows.map((row) => row.migration_name));
}

/**
 * Apply pending Prisma SQL migrations through node-pg.
 * Avoids `prisma migrate deploy` / schema-engine spawn, which fails on this
 * Windows + RDS path (`spawn UNKNOWN` during can-connect-to-database).
 */
async function applyPendingMigrations(client: PoolClient): Promise<number> {
  await ensureMigrationsTable(client);
  const applied = await appliedMigrationNames(client);
  const pending = listLocalMigrations().filter(
    (migration) => !applied.has(migration.name),
  );

  if (pending.length === 0) {
    console.log('Target schema is already up to date.');
    return 0;
  }

  console.log(`Applying ${pending.length} Prisma migration(s) via SQL...`);
  for (const migration of pending) {
    console.log(`  -> ${migration.name}`);
    await client.query(migration.sql);
    await client.query(
      `
        INSERT INTO ${quoteIdent(MIGRATIONS_TABLE)}
          ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)
      `,
      [randomUUID(), migration.checksum, migration.name],
    );
  }

  return pending.length;
}

async function ensureVectorExtension(client: PoolClient): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
}

async function buildPlan(
  source: PoolClient,
  tables: string[],
): Promise<TablePlan[]> {
  const plans: TablePlan[] = [];
  for (const table of tables) {
    const columns = await describeColumns(source, table);
    const sourceRows = await countRows(source, table);
    const sourceVectors =
      table === VECTOR_TABLE ? await countVectors(source) : null;
    plans.push({ name: table, columns, sourceRows, sourceVectors });
  }
  return plans;
}

async function copyTable(
  source: PoolClient,
  target: PoolClient,
  plan: TablePlan,
  batchSize: number,
): Promise<number> {
  if (plan.sourceRows === 0) {
    console.log(`  ${plan.name}: 0 rows`);
    return 0;
  }

  const effectiveBatch =
    plan.name === VECTOR_TABLE ? Math.min(batchSize, 25) : batchSize;
  const result = await source.query(selectSql(plan.name, plan.columns));
  let copied = 0;

  for (let i = 0; i < result.rows.length; i += effectiveBatch) {
    const batch = result.rows.slice(i, i + effectiveBatch);
    await target.query(
      insertSql(plan.name, plan.columns, batch.length),
      flattenRows(batch, plan.columns),
    );
    copied += batch.length;
    console.log(`  ${plan.name}: ${copied}/${plan.sourceRows}`);
  }

  return copied;
}

async function verify(
  source: PoolClient,
  target: PoolClient,
  plans: TablePlan[],
): Promise<void> {
  const mismatches: string[] = [];

  for (const plan of plans) {
    const targetRows = await countRows(target, plan.name);
    if (targetRows !== plan.sourceRows) {
      mismatches.push(
        `${plan.name}: source=${plan.sourceRows} target=${targetRows}`,
      );
    }
  }

  const sourceVectors = await countVectors(source);
  const targetVectors = await countVectors(target);
  if (sourceVectors !== targetVectors) {
    mismatches.push(
      `AssetEmbedding.vector: source=${sourceVectors} target=${targetVectors}`,
    );
  }

  if (mismatches.length > 0) {
    throw new Error(`Verification failed:\n${mismatches.join('\n')}`);
  }

  console.log(
    `Verification passed: ${plans.length} tables, ${sourceVectors} stored vectors.`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sourceRaw = process.env.DATABASE_URL?.trim();
  const targetRaw = process.env.TARGET_DATABASE_URL?.trim();

  if (!sourceRaw || !targetRaw) {
    throw new Error(
      'DATABASE_URL and TARGET_DATABASE_URL must both be set (see .env.example).',
    );
  }

  const sourceUrl = normalizeUrl(sourceRaw);
  const targetUrl = normalizeUrl(targetRaw);

  if (identityKey(sourceUrl) === identityKey(targetUrl)) {
    throw new Error('Source and target resolve to the same host/database.');
  }

  const sourcePool = createPool(sourceUrl);
  const targetPool = createPool(targetUrl);
  const source = await sourcePool.connect();
  const target = await targetPool.connect();

  try {
    await source.query('SELECT 1');
    await target.query('SELECT 1');
    await ensureVectorExtension(target);

    const sourceTables = await topologicalTableOrder(
      source,
      await listAppTables(source),
    );
    if (sourceTables.length === 0) {
      throw new Error('Source database has no application tables to migrate.');
    }

    const targetTables = await listAppTables(target);
    if (targetTables.length === 0 && options.dryRun) {
      console.log(
        'Dry run: target has no schema yet. A real run will apply Prisma SQL migrations in the same transaction as the data copy.',
      );
    }

    const plans = await buildPlan(source, sourceTables);
    const totalRows = plans.reduce((sum, plan) => sum + plan.sourceRows, 0);
    const vectorPlan = plans.find((plan) => plan.name === VECTOR_TABLE);

    console.log('Migration plan:');
    for (const plan of plans) {
      const vectorNote =
        plan.sourceVectors === null
          ? ''
          : ` (${plan.sourceVectors} non-null vectors)`;
      console.log(`  - ${plan.name}: ${plan.sourceRows} rows${vectorNote}`);
    }
    console.log(`Total rows: ${totalRows}`);

    if (options.dryRun) {
      console.log('Dry run complete. No data was written.');
      return;
    }

    const existingRows = await Promise.all(
      targetTables.map(async (table) => ({
        table,
        count: await countRows(target, table),
      })),
    );
    const occupied = existingRows.filter((row) => row.count > 0);
    if (occupied.length > 0 && !options.force) {
      const summary = occupied
        .map((row) => `${row.table}=${row.count}`)
        .join(', ');
      throw new Error(
        `Target already has data (${summary}). Re-run with --force to replace those tables inside the migration transaction.`,
      );
    }

    console.log(
      'Starting single transaction (schema + data). Failure rolls everything back.',
    );
    await target.query('BEGIN');
    try {
      await target.query('SET LOCAL statement_timeout = 0');
      await target.query('SET LOCAL lock_timeout = 0');
      await target.query('SET LOCAL idle_in_transaction_session_timeout = 0');

      await applyPendingMigrations(target);

      const truncateList = sourceTables.map(quoteIdent).join(', ');
      console.log(
        'Clearing target application tables so source data (including seed rows) is the only copy...',
      );
      await target.query(
        `TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`,
      );

      for (const plan of plans) {
        await copyTable(source, target, plan, options.batchSize);
      }

      await verify(source, target, plans);
      await target.query('COMMIT');
      console.log(
        `Migration committed. Copied ${totalRows} rows` +
          (vectorPlan
            ? ` including ${vectorPlan.sourceVectors ?? 0} embeddings.`
            : '.'),
      );
    } catch (error) {
      await target.query('ROLLBACK');
      console.error(
        'Migration failed. The target transaction was rolled back; existing target data (if any) is unchanged.',
      );
      throw error;
    }
  } finally {
    source.release();
    target.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
