import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { AgentJob } from '../../../../../src/adapters/data/entities/AgentJob.js';
import { PrismaAgentJobRepository } from '../../../../../src/adapters/data/prisma/PrismaAgentJobRepository.js';
import type { PrismaClient } from '../../../../../src/generated/prisma/client.js';

const silentLogger = pino({ level: 'silent' });

function createMockAgentJobDelegate(): Record<string, Mock> {
  return {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createManyAndReturn: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const AGENT_JOB: AgentJob = {
  id: 'job-1',
  user_id: 'user-1',
  agent_type: 'integration',
  status: 'queued',
  input_params: {},
  result_summary: null,
  current_step: 0,
  total_steps: 3,
  error_message: null,
  queued_at: new Date(),
  started_at: null,
  completed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('PrismaAgentJobRepository', () => {
  let baseAgentJobDelegate: Record<string, Mock>;
  let txAgentJobDelegate: Record<string, Mock>;
  let txMarker: object;
  let mockPrisma: PrismaClient;
  let repo: PrismaAgentJobRepository;

  beforeEach(() => {
    baseAgentJobDelegate = createMockAgentJobDelegate();
    txAgentJobDelegate = createMockAgentJobDelegate();
    txMarker = { agentJob: txAgentJobDelegate };

    mockPrisma = {
      agentJob: baseAgentJobDelegate,
      $transaction: vi.fn(async (fn: (tx: object) => Promise<unknown>) => fn(txMarker)),
    } as unknown as PrismaClient;

    repo = new PrismaAgentJobRepository(mockPrisma, silentLogger);
  });

  describe('findByIdWithSteps', () => {
    it('includes job_steps ordered by step_order and returns the composite entity', async () => {
      const withSteps = { ...AGENT_JOB, job_steps: [{ id: 'step-1', step_order: 1 }] };
      baseAgentJobDelegate.findUnique.mockResolvedValue(withSteps);

      const result = await repo.findByIdWithSteps('job-1');

      expect(baseAgentJobDelegate.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: { job_steps: { orderBy: { step_order: 'asc' } } },
      });
      expect(result).toEqual(withSteps);
    });

    it('returns null when the job does not exist', async () => {
      baseAgentJobDelegate.findUnique.mockResolvedValue(null);
      await expect(repo.findByIdWithSteps('missing')).resolves.toBeNull();
    });

    it('maps a driver error through mapPrismaError', async () => {
      baseAgentJobDelegate.findUnique.mockRejectedValue(new Error('boom'));
      await expect(repo.findByIdWithSteps('job-1')).rejects.toThrow(/boom/);
    });

    it('uses the transactional client when called from within transaction()', async () => {
      txAgentJobDelegate.findUnique.mockResolvedValue({ ...AGENT_JOB, job_steps: [] });

      await repo.transaction(async () => repo.findByIdWithSteps('job-1'));

      expect(txAgentJobDelegate.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: { job_steps: { orderBy: { step_order: 'asc' } } },
      });
      expect(baseAgentJobDelegate.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findByIdWithDriftEvents', () => {
    it('includes drift_events and returns the composite entity', async () => {
      const withDrift = { ...AGENT_JOB, drift_events: [{ id: 'drift-1' }] };
      baseAgentJobDelegate.findUnique.mockResolvedValue(withDrift);

      const result = await repo.findByIdWithDriftEvents('job-1');

      expect(baseAgentJobDelegate.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: { drift_events: true },
      });
      expect(result).toEqual(withDrift);
    });

    it('returns null when the job does not exist', async () => {
      baseAgentJobDelegate.findUnique.mockResolvedValue(null);
      await expect(repo.findByIdWithDriftEvents('missing')).resolves.toBeNull();
    });
  });

  describe('inherited generic CRUD', () => {
    it('findById uses the plain delegate (no include) — proves the base PrismaRepository wiring is correct', async () => {
      baseAgentJobDelegate.findUnique.mockResolvedValue(AGENT_JOB);

      const result = await repo.findById('job-1');

      expect(baseAgentJobDelegate.findUnique).toHaveBeenCalledWith({ where: { id: 'job-1' } });
      expect(result).toEqual(AGENT_JOB);
    });
  });
});
