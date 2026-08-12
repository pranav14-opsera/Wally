import { EventEmitter } from 'node:events';

export type JobEvent =
  | { type: 'status'; status: 'running' }
  | { type: 'step_started'; stepName: string; stepOrder: number }
  | { type: 'step_progress'; stepName: string; stepOrder: number; elapsedSeconds: number }
  | { type: 'step_completed'; stepName: string; stepOrder: number }
  | { type: 'completed'; result: unknown }
  | { type: 'failed'; stepName: string; error: string };

/**
 * In-process pub/sub keyed by `jobId` — the SSE route (WO-045) subscribes
 * to a job's events while a request is open; `BaseAgent` (running in the
 * same Node process, since there's no BullMQ worker process to cross —
 * see `AuthService`'s doc comment for why) publishes to it. No Redis
 * pub/sub needed for a single-process gateway.
 */
export class JobEventBus {
  private readonly emitter = new EventEmitter();

  public constructor() {
    // Multiple SSE clients (e.g. a page refresh mid-run) may subscribe to
    // the same jobId concurrently — the default 10-listener cap is too
    // low for that, not a sign of a leak.
    this.emitter.setMaxListeners(50);
  }

  public publish(jobId: string, event: JobEvent): void {
    this.emitter.emit(jobId, event);
  }

  public subscribe(jobId: string, handler: (event: JobEvent) => void): () => void {
    this.emitter.on(jobId, handler);
    return () => this.emitter.off(jobId, handler);
  }
}

export const jobEventBus = new JobEventBus();
