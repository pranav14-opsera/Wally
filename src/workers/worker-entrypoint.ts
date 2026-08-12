import { pathToFileURL } from 'node:url';

import { AgentDispatcher } from './agent-dispatcher.js';
import { workerBootstrap } from './worker-bootstrap.js';

/**
 * The worker process's `main()` — run via `npm run start:worker`, a
 * separate process/container CMD from the gateway (same Docker image,
 * per this WO's constraint). Concrete agents register themselves here
 * as their own work orders land (none exist yet); today this starts
 * with zero registrations, meaning zero BullMQ `Worker` instances and a
 * health server that reports healthy immediately — correct for a
 * from-scratch infrastructure WO, not a bug.
 */
export function main(): void {
  const dispatcher = new AgentDispatcher();

  // Future work orders (Integration/Validation/Load Testing/API
  // Lifecycle agents) add one line each here:
  //   dispatcher.register('integration', () => new IntegrationAgent(...));

  const { healthServer, shutdownHandler, logger } = workerBootstrap(dispatcher);

  healthServer.start();
  shutdownHandler.registerSignalHandlers();

  logger.info({ registeredAgentTypes: dispatcher.registeredTypes() }, 'Worker process ready');
}

// Only self-invokes when this file is the directly-executed entrypoint
// (`node dist/workers/worker-entrypoint.js` / `npm run start:worker`) —
// never on import, so tests can import `main` and exercise it with
// mocked dependencies without it trying to bind a real port or connect
// to Redis as a side effect of module loading. Compares resolved file
// URLs (not raw path strings) since `process.argv[1]` is a plain OS
// path (backslashes on Windows) while `import.meta.url` is always a
// `file://` URL — a naive string comparison would never match on
// Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
