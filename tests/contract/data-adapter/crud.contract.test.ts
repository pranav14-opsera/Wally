import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { BaseEntity, IRepository } from '../../../src/adapters/data/index.js';
import {
  createAgentJobFixture,
  createAuditLogFixture,
  createConfigRegistryEntryFixture,
  createDriftEventFixture,
  createJobStepFixture,
  createLoadTestResultFixture,
  createMetricRegistryEntryFixture,
  createSpecRegistryEntryFixture,
  createToolRegistryEntryFixture,
  createUserFixture,
  seedAgentJob,
  seedMetricRegistry,
  seedUser,
} from './fixtures/index.js';
import type { ContractHarness, ContractRepositories } from './setup.js';
import { createContractHarness, resolveEngine } from './setup.js';

/**
 * CRUD contract tests (WO-012 AC1, AC7's happy-path counterpart, AC10):
 * create/findById/update/delete/createMany, exercised identically against
 * every one of the 10 entity types, for whichever engine `DATA_ENGINE`
 * selects (see setup.ts). Entities with foreign keys (Postgres) / a
 * parent document (Mongo's embedded JobStep/DriftEvent) seed their parent
 * first via the fixtures/index.ts seed helpers.
 */

const harness = await createContractHarness();
const engine = harness?.engine ?? resolveEngine();

interface CrudCase {
  label: string;
  repoKey: keyof ContractRepositories;
  /** Builds a fresh, valid create() input — called once per test that needs one, so re-running never collides on unique fields. */
  buildInput: (repositories: ContractRepositories) => Promise<Record<string, unknown>>;
  /** A field+value to update() with, and the field name to assert changed. */
  update: { field: string; value: unknown };
}

const CASES: CrudCase[] = [
  {
    label: 'User',
    repoKey: 'user',
    buildInput: async () => {
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createUserFixture({
        email: `crud-${randomUUID()}@example.com`,
      });
      return input;
    },
    update: { field: 'name', value: 'Updated Name' },
  },
  {
    label: 'ToolRegistryEntry',
    repoKey: 'toolRegistry',
    buildInput: async () => {
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createToolRegistryEntryFixture({
        name: `crud-tool-${randomUUID()}`,
      });
      return input;
    },
    update: { field: 'health_status', value: 'degraded' },
  },
  {
    label: 'MetricRegistryEntry',
    repoKey: 'metricRegistry',
    buildInput: async () => {
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createMetricRegistryEntryFixture({
        name: `crud-metric-direct-${randomUUID()}`,
      });
      return input;
    },
    update: { field: 'description', value: 'Updated description' },
  },
  {
    label: 'ConfigRegistryEntry',
    repoKey: 'configRegistry',
    buildInput: async () => {
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createConfigRegistryEntryFixture({
        key: `CRUD_KEY_${randomUUID()}`,
      });
      return input;
    },
    update: { field: 'value', value: '999' },
  },
  {
    label: 'SpecRegistryEntry',
    repoKey: 'specRegistry',
    buildInput: async () => {
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createSpecRegistryEntryFixture({
        api_name: `crud-api-${randomUUID()}`,
      });
      return input;
    },
    update: { field: 'checksum', value: 'sha256:updatedchecksum' },
  },
  {
    label: 'AgentJob',
    repoKey: 'agentJob',
    buildInput: async (repositories) => {
      const user = await seedUser(repositories, { email: `crud-agentjob-${randomUUID()}@example.com` });
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createAgentJobFixture({ user_id: user.id });
      return input;
    },
    update: { field: 'status', value: 'running' },
  },
  {
    label: 'JobStep',
    repoKey: 'jobStep',
    buildInput: async (repositories) => {
      const user = await seedUser(repositories, { email: `crud-jobstep-${randomUUID()}@example.com` });
      const job = await seedAgentJob(repositories, user.id);
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createJobStepFixture({ job_id: job.id });
      return input;
    },
    update: { field: 'status', value: 'completed' },
  },
  {
    label: 'AuditLog',
    repoKey: 'auditLog',
    buildInput: async (repositories) => {
      const user = await seedUser(repositories, { email: `crud-auditlog-${randomUUID()}@example.com` });
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createAuditLogFixture({ actor_id: user.id });
      return input;
    },
    update: { field: 'action', value: 'tool.update' },
  },
  {
    label: 'DriftEvent',
    repoKey: 'driftEvent',
    buildInput: async (repositories) => {
      const user = await seedUser(repositories, { email: `crud-drift-${randomUUID()}@example.com` });
      const job = await seedAgentJob(repositories, user.id);
      const metric = await seedMetricRegistry(repositories, { name: `crud-metric-${randomUUID()}` });
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createDriftEventFixture({
        job_id: job.id,
        metric_id: metric.id,
      });
      return input;
    },
    update: { field: 'drift_type', value: 'threshold_exceeded' },
  },
  {
    label: 'LoadTestResult',
    repoKey: 'loadTestResult',
    buildInput: async (repositories) => {
      const user = await seedUser(repositories, { email: `crud-loadtest-${randomUUID()}@example.com` });
      const job = await seedAgentJob(repositories, user.id);
      const { id: _id, created_at: _c, updated_at: _u, ...input } = createLoadTestResultFixture({ job_id: job.id });
      return input;
    },
    update: { field: 'slo_verdict', value: 'fail' },
  },
];

describe.skipIf(!harness)(`CRUD contract — ${engine}`, () => {
  const activeHarness = harness as ContractHarness;

  beforeEach(async () => {
    await activeHarness.cleanup();
  });

  afterAll(async () => {
    await activeHarness.teardown();
  });

  for (const testCase of CASES) {
    describe(testCase.label, () => {
      it('create() returns the entity with a generated id and timestamps', async () => {
        const repo = activeHarness.repositories[testCase.repoKey] as IRepository<BaseEntity>;
        const input = await testCase.buildInput(activeHarness.repositories);

        const created = await repo.create(input as Omit<BaseEntity, 'id' | 'created_at' | 'updated_at'>);

        expect(created.id).toBeTruthy();
        expect(created.created_at).toBeInstanceOf(Date);
        expect(created.updated_at).toBeInstanceOf(Date);
      });

      it('findById() returns the created entity', async () => {
        const repo = activeHarness.repositories[testCase.repoKey] as IRepository<BaseEntity>;
        const input = await testCase.buildInput(activeHarness.repositories);
        const created = await repo.create(input as Omit<BaseEntity, 'id' | 'created_at' | 'updated_at'>);

        const found = await repo.findById(created.id);

        expect(found).not.toBeNull();
        expect(found?.id).toBe(created.id);
      });

      it('update() modifies the specified field and bumps updated_at', async () => {
        const repo = activeHarness.repositories[testCase.repoKey] as IRepository<BaseEntity>;
        const input = await testCase.buildInput(activeHarness.repositories);
        const created = await repo.create(input as Omit<BaseEntity, 'id' | 'created_at' | 'updated_at'>);

        // A real, if small, wall-clock gap so updated_at is provably
        // later than created_at even when both would otherwise land in
        // the same millisecond on a fast local database.
        await new Promise((resolve) => setTimeout(resolve, 5));

        const updated = await repo.update(created.id, { [testCase.update.field]: testCase.update.value } as Partial<
          Omit<BaseEntity, 'id' | 'created_at' | 'updated_at'>
        >);

        expect((updated as unknown as Record<string, unknown>)[testCase.update.field]).toEqual(testCase.update.value);
        expect(updated.updated_at.getTime()).toBeGreaterThan(created.updated_at.getTime());
      });

      it('delete() removes the entity — a subsequent findById() returns null', async () => {
        const repo = activeHarness.repositories[testCase.repoKey] as IRepository<BaseEntity>;
        const input = await testCase.buildInput(activeHarness.repositories);
        const created = await repo.create(input as Omit<BaseEntity, 'id' | 'created_at' | 'updated_at'>);

        await repo.delete(created.id);

        await expect(repo.findById(created.id)).resolves.toBeNull();
      });
    });
  }

  // createMany is exercised on ToolRegistryEntry specifically: no FK/parent
  // dependency, so two independent valid inputs can be built without extra
  // seeding, keeping this assertion about createMany's own atomicity/shape
  // guarantee rather than the seeding boilerplate the per-entity loop above
  // already covers once per entity.
  it('createMany() creates multiple entities and returns all of them', async () => {
    const repo = activeHarness.repositories.toolRegistry;
    const first = createToolRegistryEntryFixture({ name: `crud-many-a-${randomUUID()}` });
    const second = createToolRegistryEntryFixture({ name: `crud-many-b-${randomUUID()}` });
    const { id: _i1, created_at: _c1, updated_at: _u1, ...firstInput } = first;
    const { id: _i2, created_at: _c2, updated_at: _u2, ...secondInput } = second;

    const created = await repo.createMany([firstInput, secondInput]);

    expect(created).toHaveLength(2);
    expect(created.map((entity) => entity.name).sort()).toEqual([first.name, second.name].sort());
    for (const entity of created) {
      expect(entity.id).toBeTruthy();
    }
  });
});
