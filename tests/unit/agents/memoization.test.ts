import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { StepSerializationError, TransactionFailedError } from '../../../src/agents/errors.js';
import { StepMemoizer } from '../../../src/agents/memoization.js';
import memoizationSeedData from '../../fixtures/agents/memoization-seed-data.json';
import { FakeRedisClient } from '../../helpers/mock-redis.js';

const silentLogger = pino({ level: 'silent' });
const TTL_SECONDS = 3_600;
const LARGE_RESULT_WARN_BYTES = 1_000_000;

let redis: FakeRedisClient;
let memoizer: StepMemoizer;

beforeEach(() => {
  redis = new FakeRedisClient();
  memoizer = new StepMemoizer(redis, TTL_SECONDS, silentLogger, LARGE_RESULT_WARN_BYTES);
});

describe('StepMemoizer', () => {
  describe('constructor', () => {
    it.each([
      ['redis', () => [undefined, TTL_SECONDS, silentLogger, LARGE_RESULT_WARN_BYTES]],
      ['ttlSeconds', () => [new FakeRedisClient(), 0, silentLogger, LARGE_RESULT_WARN_BYTES]],
      ['ttlSeconds', () => [new FakeRedisClient(), -5, silentLogger, LARGE_RESULT_WARN_BYTES]],
      ['logger', () => [new FakeRedisClient(), TTL_SECONDS, undefined, LARGE_RESULT_WARN_BYTES]],
      ['largeResultWarnBytes', () => [new FakeRedisClient(), TTL_SECONDS, silentLogger, 0]],
      ['largeResultWarnBytes', () => [new FakeRedisClient(), TTL_SECONDS, silentLogger, -5]],
    ] as const)('throws a descriptive error for an invalid %s', (name, buildArgs) => {
      const args = buildArgs();
      expect(
        () => new StepMemoizer(args[0] as never, args[1] as never, args[2] as never, args[3] as never),
      ).toThrow(new RegExp(name, 'i'));
    });
  });

  describe('hasStepResult / getStepResult / setStepResult', () => {
    it('hasStepResult is false before any result is set, true after', async () => {
      await expect(memoizer.hasStepResult('job-1', 0)).resolves.toBe(false);
      await memoizer.setStepResult('job-1', 0, { total: 8 });
      await expect(memoizer.hasStepResult('job-1', 0)).resolves.toBe(true);
    });

    it('getStepResult returns null for a step that was never cached (cache miss)', async () => {
      await expect(memoizer.getStepResult('job-1', 0)).resolves.toBeNull();
    });

    it('setStepResult then getStepResult round-trips a JSON-serializable value exactly', async () => {
      await memoizer.setStepResult('job-1', 2, { total: 8, nested: { a: [1, 2, 3], b: null } });
      await expect(memoizer.getStepResult('job-1', 2)).resolves.toEqual({ total: 8, nested: { a: [1, 2, 3], b: null } });
    });

    it('a step result of undefined is stored and round-trips as null (JSON has no undefined)', async () => {
      await memoizer.setStepResult('job-1', 4, undefined);
      await expect(memoizer.hasStepResult('job-1', 4)).resolves.toBe(true);
      await expect(memoizer.getStepResult('job-1', 4)).resolves.toBeNull();
    });

    it('different jobIds and stepOrders are cached independently', async () => {
      await memoizer.setStepResult('job-1', 0, 'a');
      await memoizer.setStepResult('job-1', 1, 'b');
      await memoizer.setStepResult('job-2', 0, 'c');

      await expect(memoizer.getStepResult('job-1', 0)).resolves.toBe('a');
      await expect(memoizer.getStepResult('job-1', 1)).resolves.toBe('b');
      await expect(memoizer.getStepResult('job-2', 0)).resolves.toBe('c');
    });

    it('seeding from the committed memoization-seed-data.json fixture round-trips every cached step and advances the checkpoint to the last one', async () => {
      const { jobId, cachedSteps } = memoizationSeedData;
      for (const { stepOrder, result } of cachedSteps) {
        await memoizer.setStepResult(jobId, stepOrder, result);
      }

      for (const { stepOrder, result } of cachedSteps) {
        await expect(memoizer.hasStepResult(jobId, stepOrder)).resolves.toBe(true);
        await expect(memoizer.getStepResult(jobId, stepOrder)).resolves.toEqual(result);
      }
      await expect(memoizer.getCheckpoint(jobId)).resolves.toBe(
        cachedSteps[cachedSteps.length - 1]!.stepOrder,
      );
    });

    it('setStepResult throws StepSerializationError for a circular-reference result', async () => {
      const circular: Record<string, unknown> = { self: null };
      circular.self = circular;

      await expect(memoizer.setStepResult('job-1', 0, circular)).rejects.toBeInstanceOf(StepSerializationError);
    });

    it('setStepResult throws StepSerializationError for a result containing a function value', async () => {
      await expect(memoizer.setStepResult('job-1', 0, { handler: () => 1 })).rejects.toBeInstanceOf(
        StepSerializationError,
      );
      await expect(memoizer.setStepResult('job-1', 0, () => 1)).rejects.toBeInstanceOf(StepSerializationError);
    });

    it('setStepResult throws StepSerializationError for a function nested deep inside an array', async () => {
      await expect(memoizer.setStepResult('job-1', 0, { list: [1, { deep: () => 1 }] })).rejects.toBeInstanceOf(
        StepSerializationError,
      );
    });

    it('a StepSerializationError includes the jobId and stepOrder', async () => {
      let thrown: StepSerializationError | undefined;
      try {
        await memoizer.setStepResult('job-42', 3, () => 1);
        expect.unreachable();
      } catch (error) {
        thrown = error as StepSerializationError;
      }
      expect(thrown?.jobId).toBe('job-42');
      expect(thrown?.stepOrder).toBe(3);
    });

    it('setStepResult throws TransactionFailedError when the MULTI/EXEC transaction is aborted', async () => {
      redis.failNextTransactionOnce();
      await expect(memoizer.setStepResult('job-1', 0, 'value')).rejects.toBeInstanceOf(TransactionFailedError);
    });

    it('a failed transaction leaves no partial state — neither the result nor the checkpoint is set', async () => {
      redis.failNextTransactionOnce();
      await expect(memoizer.setStepResult('job-1', 0, 'value')).rejects.toThrow();

      await expect(memoizer.hasStepResult('job-1', 0)).resolves.toBe(false);
      await expect(memoizer.getCheckpoint('job-1')).resolves.toBeNull();
    });
  });

  describe('getCheckpoint', () => {
    it('returns null before any step has been checkpointed', async () => {
      await expect(memoizer.getCheckpoint('job-1')).resolves.toBeNull();
    });

    it('setStepResult atomically advances the checkpoint to the step order just written', async () => {
      await memoizer.setStepResult('job-1', 0, 'a');
      await expect(memoizer.getCheckpoint('job-1')).resolves.toBe(0);

      await memoizer.setStepResult('job-1', 3, 'b');
      await expect(memoizer.getCheckpoint('job-1')).resolves.toBe(3);
    });

    it('TTL expiry (simulated) makes the checkpoint disappear, matching the "cache expired" edge case', async () => {
      await memoizer.setStepResult('job-1', 2, 'value');
      redis.expireNow('memoize:job:job-1:checkpoint');

      await expect(memoizer.getCheckpoint('job-1')).resolves.toBeNull();
    });
  });

  describe('paused flag', () => {
    it('isPaused is false before setPaused, true after', async () => {
      await expect(memoizer.isPaused('job-1')).resolves.toBe(false);
      await memoizer.setPaused('job-1');
      await expect(memoizer.isPaused('job-1')).resolves.toBe(true);
    });

    it('clearPaused removes the flag', async () => {
      await memoizer.setPaused('job-1');
      await memoizer.clearPaused('job-1');
      await expect(memoizer.isPaused('job-1')).resolves.toBe(false);
    });

    it('clearPaused on a job with no flag set does not throw', async () => {
      await expect(memoizer.clearPaused('never-paused')).resolves.toBeUndefined();
    });
  });

  describe('clearJobCache', () => {
    it('removes every cached step result up to the checkpoint, plus the checkpoint and paused-flag keys', async () => {
      await memoizer.setStepResult('job-1', 0, 'a');
      await memoizer.setStepResult('job-1', 1, 'b');
      await memoizer.setStepResult('job-1', 2, 'c');
      await memoizer.setPaused('job-1');

      await memoizer.clearJobCache('job-1');

      await expect(memoizer.hasStepResult('job-1', 0)).resolves.toBe(false);
      await expect(memoizer.hasStepResult('job-1', 1)).resolves.toBe(false);
      await expect(memoizer.hasStepResult('job-1', 2)).resolves.toBe(false);
      await expect(memoizer.getCheckpoint('job-1')).resolves.toBeNull();
      await expect(memoizer.isPaused('job-1')).resolves.toBe(false);
    });

    it('completes without error for a job with nothing cached', async () => {
      await expect(memoizer.clearJobCache('never-ran')).resolves.toBeUndefined();
    });

    it('does not affect another job\'s cache', async () => {
      await memoizer.setStepResult('job-1', 0, 'a');
      await memoizer.setStepResult('job-2', 0, 'b');

      await memoizer.clearJobCache('job-1');

      await expect(memoizer.hasStepResult('job-2', 0)).resolves.toBe(true);
    });
  });
});
