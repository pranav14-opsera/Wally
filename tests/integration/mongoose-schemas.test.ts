import mongoose from 'mongoose';
import { afterAll, describe, expect, it } from 'vitest';

import { createModels } from '../../src/adapters/data/mongoose/models.js';

// Requires a real, reachable MongoDB 7 instance — not available by
// default until WO-053's Docker Compose stack exists. Probed once up
// front (not per-test) so the whole suite skips cleanly with a clear
// reason instead of every test failing with a connection error when no
// database is running (e.g. `docker compose up -d mongo`).
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017';
const DB_NAME = `wally_schema_test_${Date.now()}`;
const CONNECTION_TIMEOUT_MS = 2000;
const RETENTION_DAYS_FOR_TEST = 90;

async function probeMongo(): Promise<boolean> {
  const connection = mongoose.createConnection(MONGO_URI, {
    dbName: DB_NAME,
    serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
  });
  try {
    await connection.asPromise();
    await connection.close();
    return true;
  } catch {
    await connection.close().catch(() => undefined);
    return false;
  }
}

const dbAvailable = await probeMongo();

if (!dbAvailable) {
  console.warn(
    `Skipping Mongoose schema integration tests — no MongoDB reachable at ${MONGO_URI}. ` +
      'Start one (e.g. `docker compose up -d mongo` once WO-053 lands) to run these.',
  );
}

describe.skipIf(!dbAvailable)('Mongoose schemas — MongoDB 7', () => {
  let connection: mongoose.Connection;
  let models: ReturnType<typeof createModels>;

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });

  it('connects and registers all 8 collections without error', async () => {
    connection = mongoose.createConnection(MONGO_URI, { dbName: DB_NAME });
    await connection.asPromise();
    models = createModels(connection);
    expect(Object.keys(models)).toHaveLength(8);
  });

  it('inserts and queries a User document', async () => {
    const user = await models.User.create({ email: 'a@example.com', name: 'Ada', password_hash: 'hash' });
    const found = await models.User.findById(user._id);
    expect(found?.email).toBe('a@example.com');
  });

  it('inserts an AgentJob with embedded job_steps and drift_events, then queries them back', async () => {
    const job = await models.AgentJob.create({
      user_id: 'u-1',
      agent_type: 'validation',
      total_steps: 2,
      job_steps: [
        { step_order: 1, step_name: 'fetch' },
        { step_order: 2, step_name: 'compare' },
      ],
      drift_events: [
        {
          metric_id: 'm-1',
          source_value: 10,
          dashboard_value: 12,
          drift_type: 'value_mismatch',
          affected_records: { count: 1 },
        },
      ],
    });

    const found = await models.AgentJob.findById(job._id);
    expect(found?.job_steps).toHaveLength(2);
    expect(found?.job_steps[0]?.step_name).toBe('fetch');
    expect(found?.drift_events).toHaveLength(1);
    expect(found?.drift_events[0]?.metric_id).toBe('m-1');
  });

  it('rejects a duplicate name on ToolRegistry (unique index enforced by MongoDB, not just schema validation)', async () => {
    await models.ToolRegistry.create({ name: 'dup-tool', description: 'x', endpoints: {} });
    await expect(models.ToolRegistry.create({ name: 'dup-tool', description: 'y', endpoints: {} })).rejects.toThrow();
  });

  it('rejects a duplicate (api_name, version) pair on SpecRegistry', async () => {
    await models.SpecRegistry.create({ api_name: 'orders-api', version: '1.0', spec_content: {}, checksum: 'a' });
    await expect(
      models.SpecRegistry.create({ api_name: 'orders-api', version: '1.0', spec_content: {}, checksum: 'b' }),
    ).rejects.toThrow();
  });

  it('creates the expected indexes on the AgentJob collection', async () => {
    const indexes = await models.AgentJob.collection.indexes();
    const indexKeys = indexes.map((index) => JSON.stringify(index.key));
    expect(indexKeys).toContain(JSON.stringify({ agent_type: 1, status: 1, created_at: 1 }));
    expect(indexKeys).toContain(JSON.stringify({ user_id: 1, created_at: 1 }));
  });

  it('creates a TTL index on AuditLog.created_at', async () => {
    const auditLogSchema = (await import('../../src/adapters/data/mongoose/schemas/AuditLog.schema.js')).createAuditLogSchema(
      RETENTION_DAYS_FOR_TEST,
    );
    const AuditLogModel = connection.model('AuditLogTtlCheck', auditLogSchema);
    await AuditLogModel.createIndexes();

    const indexes = await AuditLogModel.collection.indexes();
    const ttlIndex = indexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ created_at: 1 }));
    expect(ttlIndex?.expireAfterSeconds).toBe(RETENTION_DAYS_FOR_TEST * 86_400);
  });
});
