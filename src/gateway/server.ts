import { fileURLToPath } from 'node:url';

// Loads `.env` into `process.env` before anything else reads it — the
// gateway is run directly with `node dist/gateway/server.js`, not through
// a dev tool that does this automatically.
import 'dotenv/config';

import type { FastifyInstance } from 'fastify';

import { bootstrap } from '../bootstrap.js';
import { buildApp } from './app.js';
import type { GatewayContainer } from './types.js';

/**
 * Wires graceful shutdown for an already-built `app` and starts listening.
 * Exported separately from `main()` below so tests can drive the shutdown
 * behavior against a fake container/app without going through a real
 * `bootstrap()` or binding a real port.
 *
 * `bootstrap()` already registered its own SIGTERM/SIGINT handler
 * (src/bootstrap.ts) that disconnects the data adapter and exits — this
 * handler runs *in addition* to that one, draining in-flight HTTP
 * requests via `app.close()`. Both listeners fire on the same signal;
 * whichever finishes first calls `process.exit`, which is fine for a
 * single-process deployment where "the process is going down" is the
 * only outcome either handler cares about.
 */
export async function runServer(container: GatewayContainer, app: FastifyInstance): Promise<void> {
  const { logger, config } = container;
  let isShuttingDown = false;

  const shutdown = (signal: NodeJS.Signals | 'unhandledRejection' | 'uncaughtException'): void => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info({ signal }, 'Gateway received shutdown signal — draining in-flight requests');

    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn(
          { signal, timeoutMs: config.SHUTDOWN_TIMEOUT_MS },
          'Gateway drain did not complete within the shutdown timeout — closing anyway',
        );
        resolve();
      }, config.SHUTDOWN_TIMEOUT_MS);
    });

    Promise.race([app.close().then(() => logger.info({ signal }, 'Gateway closed cleanly')), timeout])
      .catch((error: unknown) => {
        logger.error({ err: error, signal }, 'Error while closing gateway');
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection — shutting down gateway');
    shutdown('unhandledRejection');
  });
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — shutting down gateway');
    shutdown('uncaughtException');
  });

  await app.listen({ port: config.PORT, host: config.HOST });
}

async function main(): Promise<void> {
  const container = await bootstrap();
  const app = await buildApp(container);
  await runServer(container, app);
}

// ESM equivalent of Python's `if __name__ == '__main__'` — lets tests
// `import` this module (to reach `runServer`) without triggering a real
// bootstrap + port bind, while `node dist/gateway/server.js` still runs it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Fatal error during gateway startup: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
}
