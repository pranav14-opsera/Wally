import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentJob } from '../../../src/adapters/data/entities/AgentJob.js';
import type { JobStep } from '../../../src/adapters/data/entities/JobStep.js';
import { StubRepository } from '../../../src/adapters/data/stubs/stub-repository.js';
import type { AgentJobConfig } from '../../../src/agents/types.js';
import { AgentDispatcher, UnknownAgentTypeError } from '../../../src/workers/agent-dispatcher.js';
import { createMockRedis } from '../../helpers/mock-redis.js';
import { TestAgent, type TestAgentInput } from '../../helpers/test-agent.js';

const silentLogger = pino({ level: 'silent' });
const CONFIG: AgentJobConfig = { agentType: 'integration', maxRetries: 3, timeoutMs: 30_000 };

async function seedJob(agentJobRepository: StubRepository<AgentJob>): Promise<AgentJob> {
  return agentJobRepository.create({
    user_id: 'user-1',
    agent_type: 'integration',
    status: 'queued',
    input_params: { seed: 3 },
    result_summary: null,
    current_step: 0,
    total_steps: 5,
    error_message: null,
    queued_at: new Date(),
    started_at: null,
    completed_at: null,
  });
}

describe('AgentDispatcher', () => {
  describe('register / isRegistered / registeredTypes', () => {
    it('isRegistered is false before register(), true after', () => {
      const dispatcher = new AgentDispatcher();
      expect(dispatcher.isRegistered('integration')).toBe(false);
      dispatcher.register('integration', () => ({ execute: vi.fn() }));
      expect(dispatcher.isRegistered('integration')).toBe(true);
    });

    it('registeredTypes returns every registered agent type, and nothing else — not a hardcoded list', () => {
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', () => ({ execute: vi.fn() }));
      dispatcher.register('some-future-agent-type', () => ({ execute: vi.fn() }));

      expect(dispatcher.registeredTypes().sort()).toEqual(['integration', 'some-future-agent-type']);
    });

    it('registeredTypes is empty for a freshly constructed dispatcher', () => {
      expect(new AgentDispatcher().registeredTypes()).toEqual([]);
    });

    it('registering the same agentType twice replaces the factory', () => {
      const dispatcher = new AgentDispatcher();
      const firstExecute = vi.fn(async () => ({ status: 'completed' as const, data: 'first', error: null }));
      const secondExecute = vi.fn(async () => ({ status: 'completed' as const, data: 'second', error: null }));
      dispatcher.register('integration', () => ({ execute: firstExecute }));
      dispatcher.register('integration', () => ({ execute: secondExecute }));

      return dispatcher.dispatch('integration', 'job-1', {}).then((result) => {
        expect(result.data).toBe('second');
        expect(firstExecute).not.toHaveBeenCalled();
      });
    });
  });

  describe('dispatch', () => {
    let agentJobRepository: StubRepository<AgentJob>;
    let jobStepRepository: StubRepository<JobStep>;

    beforeEach(() => {
      agentJobRepository = new StubRepository<AgentJob>('AgentJob');
      jobStepRepository = new StubRepository<JobStep>('JobStep');
    });

    it('resolves the registered factory, constructs an agent, and runs execute() with the given jobId/input', async () => {
      const job = await seedJob(agentJobRepository);
      const dispatcher = new AgentDispatcher();
      dispatcher.register(
        'integration',
        () => new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG),
      );

      const result = await dispatcher.dispatch('integration', job.id, { seed: 3 } as TestAgentInput);

      expect(result.status).toBe('completed');
    });

    it('constructs a fresh agent instance on every dispatch call (factory, not a singleton)', async () => {
      const factory = vi.fn(() => ({
        execute: vi.fn(async () => ({ status: 'completed' as const, data: null, error: null })),
      }));
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', factory);

      await dispatcher.dispatch('integration', 'job-1', {});
      await dispatcher.dispatch('integration', 'job-2', {});

      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('throws UnknownAgentTypeError for an unregistered agentType, listing what is registered', async () => {
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', () => ({ execute: vi.fn() }));

      let thrown: UnknownAgentTypeError | undefined;
      try {
        await dispatcher.dispatch('validation', 'job-1', {});
        expect.unreachable();
      } catch (error) {
        thrown = error as UnknownAgentTypeError;
      }

      expect(thrown).toBeInstanceOf(UnknownAgentTypeError);
      expect(thrown?.agentType).toBe('validation');
      expect(thrown?.registeredTypes).toEqual(['integration']);
      expect(thrown?.message).toContain('validation');
      expect(thrown?.message).toContain('integration');
    });

    it('UnknownAgentTypeError lists "(none)" when nothing is registered at all', async () => {
      const dispatcher = new AgentDispatcher();
      await expect(dispatcher.dispatch('anything', 'job-1', {})).rejects.toThrow(/\(none\)/);
    });

    it('propagates whatever the resolved agent\'s execute() throws (a usage error, not a job-domain failure)', async () => {
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', () => ({
        execute: vi.fn(async () => {
          throw new Error('boom');
        }),
      }));

      await expect(dispatcher.dispatch('integration', 'job-1', {})).rejects.toThrow('boom');
    });
  });
});
