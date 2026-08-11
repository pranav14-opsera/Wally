import type { AgentJob, MetricRegistryEntry, User } from '../../../../src/adapters/data/index.js';
import type { ContractRepositories } from '../setup.js';

/**
 * Re-exports WO-007's entity fixtures (tests/fixtures/entities/index.ts)
 * rather than duplicating them — AC10 requires this suite to *reuse* those
 * fixtures, not fork a second copy that could drift out of sync with the
 * ones WO-009's and WO-011's own unit tests already exercise.
 */
export * from '../../../fixtures/entities/index.js';

/**
 * Seed helpers for the FK/parent-document relationships every entity
 * below AgentJob and User has (Postgres: real foreign keys; Mongo: no
 * enforced reference, but MongooseJobStepRepository/MongooseDriftEventRepository
 * still require the parent AgentJob document to exist before `$push`ing
 * into its embedded array — see MongooseEmbeddedArrayRepository.create).
 * Centralized here so every `*.contract.test.ts` file seeds parents
 * identically instead of five slightly-different copies of the same
 * "create a user, then a job owned by it" boilerplate.
 */

import { createAgentJobFixture, createMetricRegistryEntryFixture, createUserFixture } from '../../../fixtures/entities/index.js';

export async function seedUser(repositories: ContractRepositories, overrides: Partial<User> = {}): Promise<User> {
  const { id: _id, created_at: _c, updated_at: _u, ...input } = createUserFixture(overrides);
  return repositories.user.create(input);
}

export async function seedAgentJob(
  repositories: ContractRepositories,
  userId: string,
  overrides: Partial<AgentJob> = {},
): Promise<AgentJob> {
  const { id: _id, created_at: _c, updated_at: _u, ...input } = createAgentJobFixture({ user_id: userId, ...overrides });
  return repositories.agentJob.create(input);
}

export async function seedMetricRegistry(
  repositories: ContractRepositories,
  overrides: Partial<MetricRegistryEntry> = {},
): Promise<MetricRegistryEntry> {
  const { id: _id, created_at: _c, updated_at: _u, ...input } = createMetricRegistryEntryFixture(overrides);
  return repositories.metricRegistry.create(input);
}
