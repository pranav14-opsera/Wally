import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDriftEventFixture, createJobStepFixture, seedAgentJob, seedMetricRegistry, seedUser } from './fixtures/index.js';
import type { ContractHarness } from './setup.js';
import { createContractHarness, resolveEngine } from './setup.js';

/**
 * Composite-query contract tests (WO-012 AC2, AC5's shape counterpart):
 * `findByIdWithSteps`/`findByIdWithDriftEvents` must return the identical
 * shape and data whether JobStep/DriftEvent are stored as embedded
 * documents (MongoDB, WO-010/WO-011) or separate joined-table rows
 * (Postgres, WO-008/WO-009) — this is the one abstraction boundary the
 * whole Data Adapter Module (REQ-002) exists to hide from callers.
 */

const harness = await createContractHarness();
const engine = harness?.engine ?? resolveEngine();

describe.skipIf(!harness)(`Composite query contract — ${engine}`, () => {
  const activeHarness = harness as ContractHarness;

  beforeEach(async () => {
    await activeHarness.cleanup();
  });

  afterAll(async () => {
    await activeHarness.teardown();
  });

  describe('findByIdWithSteps', () => {
    it('returns the AgentJob with its steps, sorted by step_order regardless of insertion order', async () => {
      const user = await seedUser(activeHarness.repositories, { email: `composite-steps-${randomUUID()}@example.com` });
      const job = await seedAgentJob(activeHarness.repositories, user.id, { total_steps: 3 });

      // Inserted out of order on purpose — the contract is "sorted by
      // step_order", not "sorted by insertion order", and only inserting
      // in order would leave that distinction unverified.
      const { id: _i3, created_at: _c3, updated_at: _u3, ...third } = createJobStepFixture({
        job_id: job.id,
        step_order: 3,
        step_name: 'third',
      });
      const { id: _i1, created_at: _c1, updated_at: _u1, ...first } = createJobStepFixture({
        job_id: job.id,
        step_order: 1,
        step_name: 'first',
      });
      const { id: _i2, created_at: _c2, updated_at: _u2, ...second } = createJobStepFixture({
        job_id: job.id,
        step_order: 2,
        step_name: 'second',
      });
      await activeHarness.repositories.jobStep.create(third);
      await activeHarness.repositories.jobStep.create(first);
      await activeHarness.repositories.jobStep.create(second);

      const result = await activeHarness.repositories.agentJob.findByIdWithSteps(job.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(job.id);
      expect(result?.job_steps).toHaveLength(3);
      expect(result?.job_steps.map((step) => step.step_name)).toEqual(['first', 'second', 'third']);
      expect(result?.job_steps.every((step) => step.job_id === job.id)).toBe(true);
    });

    it('returns an empty job_steps array for a job with no steps', async () => {
      const user = await seedUser(activeHarness.repositories, { email: `composite-nosteps-${randomUUID()}@example.com` });
      const job = await seedAgentJob(activeHarness.repositories, user.id, { total_steps: 0 });

      const result = await activeHarness.repositories.agentJob.findByIdWithSteps(job.id);

      expect(result?.job_steps).toEqual([]);
    });

    it('returns null for a non-existent job id', async () => {
      const result = await activeHarness.repositories.agentJob.findByIdWithSteps(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('findByIdWithDriftEvents', () => {
    it('returns the AgentJob with its drift events, each carrying the correct metric_id', async () => {
      const user = await seedUser(activeHarness.repositories, { email: `composite-drift-${randomUUID()}@example.com` });
      const job = await seedAgentJob(activeHarness.repositories, user.id, { agent_type: 'validation' });
      const metricA = await seedMetricRegistry(activeHarness.repositories, { name: `composite-metric-a-${randomUUID()}` });
      const metricB = await seedMetricRegistry(activeHarness.repositories, { name: `composite-metric-b-${randomUUID()}` });

      const { id: _i1, created_at: _c1, updated_at: _u1, ...eventA } = createDriftEventFixture({
        job_id: job.id,
        metric_id: metricA.id,
        drift_type: 'value_mismatch',
      });
      const { id: _i2, created_at: _c2, updated_at: _u2, ...eventB } = createDriftEventFixture({
        job_id: job.id,
        metric_id: metricB.id,
        drift_type: 'missing_metric',
      });
      await activeHarness.repositories.driftEvent.create(eventA);
      await activeHarness.repositories.driftEvent.create(eventB);

      const result = await activeHarness.repositories.agentJob.findByIdWithDriftEvents(job.id);

      expect(result).not.toBeNull();
      expect(result?.drift_events).toHaveLength(2);
      expect(result?.drift_events.every((event) => event.job_id === job.id)).toBe(true);
      expect(new Set(result?.drift_events.map((event) => event.metric_id))).toEqual(new Set([metricA.id, metricB.id]));
    });

    it('returns an empty drift_events array for a job with none', async () => {
      const user = await seedUser(activeHarness.repositories, { email: `composite-nodrift-${randomUUID()}@example.com` });
      const job = await seedAgentJob(activeHarness.repositories, user.id);

      const result = await activeHarness.repositories.agentJob.findByIdWithDriftEvents(job.id);

      expect(result?.drift_events).toEqual([]);
    });
  });
});
