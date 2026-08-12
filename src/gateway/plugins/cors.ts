import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'];
const EXPOSED_HEADERS = ['X-CSRF-Token', 'X-Request-ID'];
const PREFLIGHT_MAX_AGE_SECONDS = 86_400;

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '');
}

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map(normalizeOrigin)
    .filter((origin) => origin.length > 0);
}

/**
 * Must be the first plugin registered (WO-037 AC1) so CORS/preflight
 * handling happens before any other middleware or route logic runs.
 * Reads `app.container` for `CORS_ALLOWED_ORIGINS`, so `attachContainer`
 * must have already decorated the instance by the time this registers.
 */
export async function corsPlugin(app: FastifyInstance): Promise<void> {
  const allowedOrigins = parseAllowedOrigins(app.container.config.CORS_ALLOWED_ORIGINS);

  await app.register(cors, {
    origin(origin, callback) {
      // No Origin header at all (curl, server-to-server, CI tooling) —
      // there's no browser same-origin policy to enforce, so let it
      // through without adding CORS headers.
      if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  });
}
