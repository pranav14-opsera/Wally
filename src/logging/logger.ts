import pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';

// Relative import, not the @config alias: tsconfig path aliases are only
// resolved by tooling (tsc for typechecking, vite-tsconfig-paths inside
// Vitest) — there is no runtime alias resolver wired up yet for the
// compiled/executed application, so a cross-module import here must be a
// real relative path to work when the app actually runs.
import { getConfig } from '../config/index.js';
import { buildRedactConfig, DEFAULT_PII_PATHS } from './pii-redactor.js';

const VALID_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const FALLBACK_LOG_LEVEL = 'info';

/**
 * Exported for direct unit testing of the fallback/warning behavior
 * described in WO-004's error handling requirements. In practice,
 * `createLogger` only ever passes a value that already passed
 * `AppConfig`'s zod validation (or `undefined`, when validation itself
 * failed) — this function's "requested but invalid" branch is a defensive
 * guard against `AppConfig`'s allowed levels and this module's
 * `VALID_LOG_LEVELS` ever drifting out of sync.
 */
export function resolveLogLevel(baseLogger: Logger, requestedLevel: string | undefined): string {
  if (requestedLevel && VALID_LOG_LEVELS.has(requestedLevel)) {
    return requestedLevel;
  }

  if (requestedLevel) {
    baseLogger.warn(
      { requestedLevel, fallbackLevel: FALLBACK_LOG_LEVEL },
      'Unknown LOG_LEVEL requested — falling back to default level',
    );
  }

  return FALLBACK_LOG_LEVEL;
}

/**
 * Creates a Pino logger scoped to `module`, reading `LOG_LEVEL` from
 * `AppConfig`. Never throws: an invalid/missing level falls back to
 * `'info'` (with a warning logged at the fallback level) so a
 * configuration problem can never prevent the application from starting.
 *
 * `destination` is an optional override for the output stream — production
 * code should never pass it (Pino defaults to stdout); tests use it to
 * capture and assert on log output.
 */
export function createLogger(module: string, destination?: pino.DestinationStream): Logger {
  const bootstrapLogger = pino({ level: FALLBACK_LOG_LEVEL });

  let configuredLevel: string | undefined;
  try {
    configuredLevel = getConfig().LOG_LEVEL;
  } catch {
    // getConfig() throws only when required env vars are missing/invalid,
    // which is a startup-fatal condition already surfaced elsewhere (e.g.
    // bootstrap). The logger itself must still come up so that error can
    // be logged, so fall back to the default level here rather than throw.
    configuredLevel = undefined;
  }

  const level = resolveLogLevel(bootstrapLogger, configuredLevel);
  const isDevelopment = process.env.NODE_ENV === 'development';

  const options: LoggerOptions = {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: buildRedactConfig(DEFAULT_PII_PATHS),
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    base: {
      module,
      pid: process.pid,
    },
    serializers: {
      err: (error: Error & { code?: string }) => ({
        message: error.message,
        code: error.code,
        ...(isDevelopment ? { stack: error.stack } : {}),
      }),
    },
  };

  if (isDevelopment && !destination) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  }

  return destination ? pino(options, destination) : pino(options);
}
