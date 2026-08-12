import type { FastifyInstance } from 'fastify';

import type { GatewayContainer } from './types.js';

/**
 * Decorates the root Fastify instance with the already-assembled
 * `AppContainer` (WO-005's composition root, built by `bootstrap()`) so
 * every route plugin can reach adapters/services via `fastify.container`
 * instead of importing concrete implementations. Decorating the root
 * instance — not registering this as an encapsulated `fastify.register()`
 * plugin — means the decoration is visible to every child scope (Fastify's
 * plugin encapsulation only isolates decorations added *inside* a child
 * scope, not ones already present on the parent), so no `fastify-plugin`
 * wrapper dependency is needed just to share one read-only value.
 */
export function attachContainer(app: FastifyInstance, container: GatewayContainer): void {
  app.decorate('container', container);
}
