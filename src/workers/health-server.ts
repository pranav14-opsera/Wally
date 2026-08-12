import { createServer } from 'node:http';
import type { Server } from 'node:http';

import type { Logger } from 'pino';

const HEALTHY_STATUS_CODE = 200;
const UNHEALTHY_STATUS_CODE = 503;

/**
 * Minimal liveness/readiness endpoint for the worker process (WO-032) —
 * Kubernetes-style probes hit this, not a full Fastify app (the worker
 * must not import gateway-specific code, per this WO's constraint).
 * Returns 200 while the worker is processing normally, 503 once a
 * shutdown signal has been received — `isHealthy` is a callback (not a
 * snapshot taken at construction) so it always reflects
 * `GracefulShutdownHandler.shuttingDown`'s current value.
 */
export class HealthServer {
  private server: Server | undefined;

  public constructor(
    private readonly port: number,
    private readonly isHealthy: () => boolean,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    this.server = createServer((_request, response) => {
      const healthy = this.isHealthy();
      response.writeHead(healthy ? HEALTHY_STATUS_CODE : UNHEALTHY_STATUS_CODE, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: healthy ? 'ok' : 'shutting-down' }));
    });

    this.server.listen(this.port, () => {
      this.logger.info({ port: this.port }, 'Worker health check server listening');
    });
  }

  /** Idempotent — never started, or already stopped, both resolve immediately without error (safe to call unconditionally from shutdown cleanup, which doesn't track whether `start()` was ever called). */
  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
