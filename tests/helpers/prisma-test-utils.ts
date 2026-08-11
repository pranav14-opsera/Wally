import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';

import { buildPgPoolConfig } from '../../src/adapters/data/prisma/connection-string.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { AgentJob, User } from '../../src/generated/prisma/client.js';

export interface TestDatabaseConnectionParams {
  host: string;
  port: string | number;
  user: string;
  password: string;
  database: string;
}

/**
 * Builds a standalone `PrismaClient` for test use — deliberately separate
 * from the app's `getPrismaClient()` singleton (src/adapters/data/prisma/prisma-client.ts)
 * so test files never share connection-pool state with each other or with
 * application code under test. Callers own its lifecycle: call
 * `$disconnect()` in an `afterAll`.
 */
export function createTestPrismaClient(params: TestDatabaseConnectionParams): PrismaClient {
  const adapter = new PrismaPg(buildPgPoolConfig(params));
  return new PrismaClient({ adapter, log: [] });
}

/**
 * Deletes every row from every table, in FK-safe order (children before
 * parents) so no delete is blocked by a lingering reference. Intended for
 * `beforeEach`/`afterEach` in the WO-012 contract test suite and any
 * integration test that needs each case to start from a known-empty
 * database — call per-test, not once per file, since tests within a file
 * share the same database connection.
 */
export async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.driftEvent.deleteMany();
  await prisma.loadTestResult.deleteMany();
  await prisma.jobStep.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.agentJob.deleteMany();
  await prisma.user.deleteMany();
  await prisma.toolRegistry.deleteMany();
  await prisma.metricRegistry.deleteMany();
  await prisma.configRegistry.deleteMany();
  await prisma.specRegistry.deleteMany();
}

/**
 * Creates a minimal valid User row — the FK target for `AgentJob.user_id`
 * and `AuditLog.actor_id` — so tests needing a referenced user don't each
 * hand-write the same boilerplate. Defaults are unique per call
 * (`randomUUID()`-suffixed email) so parallel test runs never collide on
 * `email`'s unique constraint.
 */
export async function seedUser(prisma: PrismaClient, overrides: Partial<User> = {}): Promise<User> {
  const suffix = randomUUID();
  return prisma.user.create({
    data: {
      email: `test-${suffix}@example.com`,
      name: 'Test User',
      password_hash: 'not-a-real-hash',
      ...overrides,
    },
  });
}

/**
 * Creates a minimal valid AgentJob row referencing `userId` — the FK
 * target for JobStep, DriftEvent, and LoadTestResult.
 */
export async function seedAgentJob(
  prisma: PrismaClient,
  userId: string,
  overrides: Partial<AgentJob> = {},
): Promise<AgentJob> {
  return prisma.agentJob.create({
    data: {
      user_id: userId,
      agent_type: 'integration',
      status: 'queued',
      input_params: {},
      total_steps: 1,
      ...overrides,
    },
  });
}
