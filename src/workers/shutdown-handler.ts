import type { Logger } from 'pino';

export interface Closeable {
  close(): Promise<void>;
}

export type ShutdownResult = 'closed' | 'timeout' | 'already-in-progress';

/**
 * Drains every registered `Worker` (stop accepting new jobs, let
 * in-flight ones finish) within a bounded timeout, then runs `cleanup`
 * (closing Redis connections etc.) — the sequence described in this
 * WO's own technical_details. `shutdown()` itself never calls
 * `process.exit` and is fully unit-testable; `registerSignalHandlers()`
 * is the thin, untested-by-design wrapper (matching `src/bootstrap.ts`'s
 * own `registerShutdownHooks` precedent) that wires SIGTERM/SIGINT to it
 * and performs the actual exit.
 */
export class GracefulShutdownHandler {
  private isShuttingDown = false;
  private signalHandlersRegistered = false;

  public constructor(
    private readonly workers: readonly Closeable[],
    private readonly cleanup: () => Promise<void>,
    private readonly drainTimeoutMs: number,
    private readonly logger: Logger,
  ) {}

  public get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Idempotent — a second call (e.g. SIGTERM followed by SIGINT, or two
   * SIGTERMs) while a shutdown is already in progress returns
   * `'already-in-progress'` immediately without re-closing anything.
   */
  public async shutdown(signal: string): Promise<ShutdownResult> {
    if (this.isShuttingDown) {
      this.logger.info({ signal }, 'Shutdown already in progress — ignoring duplicate signal');
      return 'already-in-progress';
    }
    this.isShuttingDown = true;
    this.logger.info({ signal, workerCount: this.workers.length }, 'Shutdown initiated — draining active jobs');

    const drained = Promise.all(this.workers.map((worker) => worker.close())).then(() => 'closed' as const);
    const timedOut = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), this.drainTimeoutMs);
    });

    const result = await Promise.race([drained, timedOut]);

    if (result === 'timeout') {
      this.logger.warn(
        { signal, drainTimeoutMs: this.drainTimeoutMs },
        'Drain timeout exceeded — forcing shutdown with jobs still in flight',
      );
    } else {
      this.logger.info({ signal }, 'All workers drained');
    }

    try {
      await this.cleanup();
      this.logger.info({ signal, result }, 'Shutdown complete');
    } catch (error) {
      this.logger.error({ signal, err: error }, 'Cleanup failed during shutdown');
    }

    return result;
  }

  /** Registers `once` SIGTERM/SIGINT handlers that call `shutdown()` then `process.exit(0)` on a clean drain or `process.exit(1)` on a timeout. Guarded by its own flag (not just `process.once`'s per-signal semantics) so calling `register()` twice on the same instance never double-registers. */
  public registerSignalHandlers(): void {
    if (this.signalHandlersRegistered) {
      return;
    }
    this.signalHandlersRegistered = true;

    const onSignal = (signal: NodeJS.Signals): void => {
      this.shutdown(signal)
        .then((result) => {
          process.exit(result === 'timeout' ? 1 : 0);
        })
        .catch((error: unknown) => {
          this.logger.error({ signal, err: error }, 'Unexpected error during shutdown');
          process.exit(1);
        });
    };

    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  }
}
