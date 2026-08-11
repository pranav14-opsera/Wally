import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';
import type { Connection } from 'mongoose';

import { createModels } from '../../src/adapters/data/mongoose/models.js';
import type { MongooseModels } from '../../src/adapters/data/mongoose/models.js';
import type { UserDoc } from '../../src/adapters/data/mongoose/schemas/User.schema.js';

/**
 * Creates a standalone Mongoose connection + registered models for test
 * use — deliberately separate from the app's `getMongooseConnection()`
 * singleton (src/adapters/data/mongoose/mongoose-client.ts) so test files
 * never share connection state with each other or with application code
 * under test. Callers own its lifecycle: call `.close()` in an `afterAll`.
 */
export async function createTestMongooseConnection(
  uri: string,
  dbName: string,
): Promise<{ connection: Connection; models: MongooseModels }> {
  const connection = mongoose.createConnection(uri, { dbName });
  await connection.asPromise();
  return { connection, models: createModels(connection) };
}

/**
 * Drops every collection's documents (not the collections themselves —
 * cheaper, and avoids re-creating indexes every test) so each test case
 * starts from a known-empty database. Call in `beforeEach`/`afterEach`,
 * not once per file, since tests within a file share the same connection.
 */
export async function cleanDatabase(models: MongooseModels): Promise<void> {
  await Promise.all([
    models.User.deleteMany({}),
    models.AgentJob.deleteMany({}),
    models.ToolRegistry.deleteMany({}),
    models.MetricRegistry.deleteMany({}),
    models.ConfigRegistry.deleteMany({}),
    models.SpecRegistry.deleteMany({}),
    models.AuditLog.deleteMany({}),
    models.LoadTestResult.deleteMany({}),
  ]);
}

/**
 * Creates a minimal valid User document — the referenced entity for
 * `AgentJob.user_id` and `AuditLog.actor_id` — so tests needing one
 * don't each hand-write the same boilerplate. Defaults are unique per
 * call (`randomUUID()`-suffixed email) so parallel test runs never
 * collide on the unique index on `email`.
 */
export async function seedUser(models: MongooseModels, overrides: Partial<UserDoc> = {}) {
  const suffix = randomUUID();
  return models.User.create({
    email: `test-${suffix}@example.com`,
    name: 'Test User',
    password_hash: 'not-a-real-hash',
    ...overrides,
  });
}

/**
 * Creates a minimal valid AgentJob document referencing `userId`, with
 * no embedded job_steps/drift_events unless `overrides` supplies them.
 */
export async function seedAgentJob(models: MongooseModels, userId: string, overrides: Record<string, unknown> = {}) {
  return models.AgentJob.create({
    user_id: userId,
    agent_type: 'integration',
    status: 'queued',
    input_params: {},
    total_steps: 1,
    ...overrides,
  });
}
