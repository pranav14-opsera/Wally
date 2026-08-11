import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

// Requires a real, reachable PostgreSQL 15 instance — not available by
// default until WO-053's Docker Compose stack exists. Probed once up
// front (not per-test) so the whole suite skips cleanly with a clear
// reason instead of every test failing with a connection error when no
// database is running (e.g. `docker compose up -d postgres`).
const HOST = process.env.POSTGRES_HOST ?? 'localhost';
const PORT = Number(process.env.POSTGRES_PORT ?? 5432);
const USER = process.env.POSTGRES_USER ?? 'wally';
const PASSWORD = process.env.POSTGRES_PASSWORD ?? 'change-me';
const ADMIN_DATABASE = process.env.POSTGRES_DB ?? 'wally';

const TEST_DB_NAME = `wally_migration_test_${randomUUID().replaceAll('-', '_')}`;

function connectAdmin(): Client {
  return new Client({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: ADMIN_DATABASE,
    connectionTimeoutMillis: 2000,
  });
}

async function probePostgres(): Promise<boolean> {
  const client = connectAdmin();
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

function readInitialMigrationSql(): string {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
  const [migrationDir] = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!migrationDir) {
    throw new Error(`No migration directory found under ${migrationsDir}`);
  }
  return readFileSync(join(migrationsDir, migrationDir, 'migration.sql'), 'utf-8');
}

const EXPECTED_TABLES = [
  'agent_jobs',
  'audit_logs',
  'config_registry',
  'drift_events',
  'job_steps',
  'load_test_results',
  'metric_registry',
  'spec_registry',
  'tool_registry',
  'users',
].sort();

const dbAvailable = await probePostgres();

if (!dbAvailable) {
  console.warn(
    `Skipping Prisma migration integration tests — no PostgreSQL reachable at ${HOST}:${PORT}. ` +
      'Start one (e.g. `docker compose up -d postgres` once WO-053 lands) to run these.',
  );
}

describe.skipIf(!dbAvailable)('Prisma initial migration — PostgreSQL 15', () => {
  let testClient: Client;

  afterAll(async () => {
    await testClient?.end();
    const admin = connectAdmin();
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
    await admin.end();
  });

  it('applies the initial migration to a freshly created database without errors', async () => {
    const admin = connectAdmin();
    await admin.connect();
    await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
    await admin.end();

    testClient = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB_NAME });
    await testClient.connect();

    await expect(testClient.query(readInitialMigrationSql())).resolves.toBeDefined();
  });

  it('creates all 10 entity tables', async () => {
    const result = await testClient.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    expect(result.rows.map((row) => row.tablename).sort()).toEqual(EXPECTED_TABLES);
  });

  it('rejects a foreign key referencing a non-existent AgentJob', async () => {
    await expect(
      testClient.query(
        `INSERT INTO job_steps (id, job_id, step_order, step_name, status, created_at, updated_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'step', 'pending', now(), now())`,
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects a duplicate value on a unique constraint', async () => {
    await testClient.query(
      `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
       VALUES (gen_random_uuid(), 'dup@example.com', 'First', 'hash', now(), now())`,
    );

    await expect(
      testClient.query(
        `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
         VALUES (gen_random_uuid(), 'dup@example.com', 'Second', 'hash', now(), now())`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('sets audit_logs.actor_id to NULL when the referenced user is deleted (onDelete: SetNull)', async () => {
    const { rows } = await testClient.query<{ id: string }>(
      `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
       VALUES (gen_random_uuid(), 'to-delete@example.com', 'Deletable', 'hash', now(), now())
       RETURNING id`,
    );
    const userId = rows[0]?.id;

    await testClient.query(
      `INSERT INTO audit_logs (id, actor_id, action, resource_type, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'login', 'session', now(), now())`,
      [userId],
    );

    await testClient.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows: auditRows } = await testClient.query<{ actor_id: string | null }>(
      'SELECT actor_id FROM audit_logs WHERE action = $1',
      ['login'],
    );
    expect(auditRows[0]?.actor_id).toBeNull();
  });
});
