import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GracefulShutdownHandler } from '../../../src/workers/shutdown-handler.js';

const silentLogger = pino({ level: 'silent' });
const DRAIN_TIMEOUT_MS = 5_000;

describe('GracefulShutdownHandler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('shutdown', () => {
    it('closes every worker and runs cleanup, resolving "closed" when draining finishes before the timeout', async () => {
      const closeMocks = [vi.fn(async () => undefined), vi.fn(async () => undefined)];
      const cleanup = vi.fn(async () => undefined);
      const handler = new GracefulShutdownHandler(
        closeMocks.map((close) => ({ close })),
        cleanup,
        DRAIN_TIMEOUT_MS,
        silentLogger,
      );

      const result = await handler.shutdown('SIGTERM');

      expect(result).toBe('closed');
      expect(closeMocks[0]).toHaveBeenCalledTimes(1);
      expect(closeMocks[1]).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('sets shuttingDown to true immediately, before close()/cleanup() resolve', async () => {
      let observedDuringClose = false;
      const handler = new GracefulShutdownHandler(
        [
          {
            close: async () => {
              observedDuringClose = handler.shuttingDown;
            },
          },
        ],
        async () => undefined,
        DRAIN_TIMEOUT_MS,
        silentLogger,
      );

      expect(handler.shuttingDown).toBe(false);
      await handler.shutdown('SIGTERM');
      expect(observedDuringClose).toBe(true);
    });

    it('completes immediately (well under the timeout) when there are zero workers to drain', async () => {
      const handler = new GracefulShutdownHandler([], async () => undefined, DRAIN_TIMEOUT_MS, silentLogger);

      const startedAt = Date.now();
      const result = await handler.shutdown('SIGTERM');

      expect(result).toBe('closed');
      expect(Date.now() - startedAt).toBeLessThan(DRAIN_TIMEOUT_MS);
    });

    it('is idempotent — a second call while a shutdown is already in progress resolves "already-in-progress" without re-closing anything', async () => {
      let resolveClose!: () => void;
      const closeMock = vi.fn(() => new Promise<void>((resolve) => { resolveClose = resolve; }));
      const handler = new GracefulShutdownHandler([{ close: closeMock }], async () => undefined, DRAIN_TIMEOUT_MS, silentLogger);

      const first = handler.shutdown('SIGTERM');
      const second = await handler.shutdown('SIGINT');

      expect(second).toBe('already-in-progress');
      expect(closeMock).toHaveBeenCalledTimes(1);

      resolveClose();
      await first;
    });

    it('returns "timeout" and still runs cleanup when a worker\'s close() never resolves within drainTimeoutMs', async () => {
      vi.useFakeTimers();
      try {
        const cleanup = vi.fn(async () => undefined);
        const handler = new GracefulShutdownHandler(
          [{ close: () => new Promise(() => {}) }],
          cleanup,
          DRAIN_TIMEOUT_MS,
          silentLogger,
        );

        const shutdownPromise = handler.shutdown('SIGTERM');
        await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS);
        const result = await shutdownPromise;

        expect(result).toBe('timeout');
        expect(cleanup).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still resolves (does not throw) when cleanup() itself rejects — logged, not propagated', async () => {
      const handler = new GracefulShutdownHandler(
        [],
        async () => {
          throw new Error('cleanup failed');
        },
        DRAIN_TIMEOUT_MS,
        silentLogger,
      );

      await expect(handler.shutdown('SIGTERM')).resolves.toBe('closed');
    });
  });

  describe('registerSignalHandlers', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    });

    afterEach(() => {
      exitSpy.mockRestore();
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGINT');
    });

    it('registers exactly one SIGTERM and one SIGINT listener, even if called twice', () => {
      const handler = new GracefulShutdownHandler([], async () => undefined, DRAIN_TIMEOUT_MS, silentLogger);

      handler.registerSignalHandlers();
      handler.registerSignalHandlers();

      expect(process.listenerCount('SIGTERM')).toBe(1);
      expect(process.listenerCount('SIGINT')).toBe(1);
    });

    it('a SIGTERM signal triggers shutdown() and calls process.exit(0) on a clean drain', async () => {
      const handler = new GracefulShutdownHandler([], async () => undefined, DRAIN_TIMEOUT_MS, silentLogger);
      handler.registerSignalHandlers();

      process.emit('SIGTERM');
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    });

    it('calls process.exit(1) when the drain times out', async () => {
      vi.useFakeTimers();
      try {
        const handler = new GracefulShutdownHandler(
          [{ close: () => new Promise(() => {}) }],
          async () => undefined,
          DRAIN_TIMEOUT_MS,
          silentLogger,
        );
        handler.registerSignalHandlers();

        process.emit('SIGTERM');
        await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS);
        await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
