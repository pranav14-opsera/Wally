import type { Role } from './roles.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** No default — every route must declare this explicitly (deny-by-default, WO-041 AC5). Use `Role.PUBLIC` to bypass auth/RBAC entirely. */
    requiredRole?: Role;
  }
}
