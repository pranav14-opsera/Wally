import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*; img-src 'self' data:";
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:";
const HSTS_MAX_AGE_SECONDS = 31_536_000;
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

function toCamelCase(directive: string): string {
  return directive.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Parses a semicolon-separated CSP header string (e.g. `"default-src 'self'; script-src 'self'"`) into `@fastify/helmet`'s directive-object shape. Throws on malformed input — the caller decides the fallback. */
function parseCspString(csp: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};

  for (const clause of csp.split(';')) {
    const trimmed = clause.trim();
    if (!trimmed) {
      continue;
    }
    const [name, ...values] = trimmed.split(/\s+/);
    if (!name || values.length === 0) {
      throw new Error(`Malformed CSP clause: "${trimmed}"`);
    }
    directives[toCamelCase(name)] = values;
  }

  if (Object.keys(directives).length === 0) {
    throw new Error('CSP string contained no directives');
  }

  return directives;
}

function resolveCspDirectives(csp: string | undefined, nodeEnv: string, logger: Logger): Record<string, string[]> {
  const fallback = nodeEnv === 'production' ? PROD_CSP : DEV_CSP;
  if (!csp) {
    return parseCspString(fallback);
  }

  try {
    return parseCspString(csp);
  } catch (error) {
    logger.warn({ err: error, csp }, 'CSP_DIRECTIVES is malformed — falling back to the environment default CSP');
    return parseCspString(fallback);
  }
}

/**
 * Registered after CORS but before route plugins (WO-038 AC/technical
 * details). CSP is environment-aware: local dev needs `'unsafe-eval'`/
 * websocket connect-src for Vite HMR, production is locked down. HSTS
 * only applies in production — asserting it over local plain-HTTP dev
 * would make browsers refuse to downgrade back to HTTP.
 */
export async function securityHeadersPlugin(app: FastifyInstance): Promise<void> {
  const { config, logger } = app.container;
  const directives = resolveCspDirectives(config.CSP_DIRECTIVES, config.NODE_ENV, logger);

  await app.register(helmet, {
    // `useDefaults: false` — the WO's dev/prod default strings and
    // `CSP_DIRECTIVES` are both already-complete policies; letting
    // helmet merge in its own baseline defaults on top would silently
    // add directives neither this code nor the env var asked for.
    contentSecurityPolicy: { useDefaults: false, directives },
    hsts: config.NODE_ENV === 'production' ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
  });

  // @fastify/helmet has no built-in Permissions-Policy support and never
  // sets X-Powered-By in the first place (that's an Express convention) —
  // both handled directly here so every response carries them regardless,
  // satisfying this WO's explicit AC on both headers.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Permissions-Policy', PERMISSIONS_POLICY);
    reply.removeHeader('X-Powered-By');
    return payload;
  });
}
