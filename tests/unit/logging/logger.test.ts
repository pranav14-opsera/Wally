import { Writable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSampleLogPayload } from '../../fixtures/log-events.fixture.js';

/** Captures newline-delimited JSON log lines written by a Pino logger. */
function createCaptureStream(): { stream: Writable; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown),
  };
}

describe('createLogger', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      CLOUD_PROVIDER: 'local',
      DATA_ENGINE: 'postgres',
      POSTGRES_DB: 'wally_test',
      POSTGRES_USER: 'wally',
      POSTGRES_PASSWORD: 'test-password',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      REDIS_URL: 'redis://localhost:6379',
      JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
      JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
      LOCAL_SECRETS_MASTER_KEY: 'a'.repeat(32),
    };
    vi.resetModules();
  });

  it('produces JSON output with the module name in the base context', async () => {
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    logger.info('hello');

    const [entry] = lines() as Array<{ module: string; msg: string }>;
    expect(entry?.module).toBe('test-module');
    expect(entry?.msg).toBe('hello');
  });

  it('produces an ISO 8601 timestamp field', async () => {
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    logger.info('hello');

    const [entry] = lines() as Array<{ time: string }>;
    expect(entry?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('redacts PII fields (email, password, token) in logged objects', async () => {
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    logger.info(createSampleLogPayload(), 'payload received');

    const [entry] = lines() as Array<{ email: string; password: string; token: string }>;
    expect(entry?.email).toBe('[REDACTED]');
    expect(entry?.password).toBe('[REDACTED]');
    expect(entry?.token).toBe('[REDACTED]');
  });

  it('respects LOG_LEVEL=warn by suppressing info-level messages', async () => {
    process.env.LOG_LEVEL = 'warn';
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    logger.info('should be suppressed');
    logger.warn('should appear');

    const entries = lines() as Array<{ msg: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe('should appear');
  });

  it('produces no output at all when LOG_LEVEL=silent', async () => {
    process.env.LOG_LEVEL = 'silent';
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    logger.fatal('should not appear');
    logger.error('should not appear');
    logger.warn('should not appear');

    expect(lines()).toHaveLength(0);
  });

  it('falls back to info level for an unknown LOG_LEVEL instead of throwing', async () => {
    process.env.LOG_LEVEL = 'not-a-real-level';
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    expect(() => createLogger('test-module', stream)).not.toThrow();

    const logger = createLogger('test-module', stream);
    logger.info('fallback works');

    const entries = lines() as Array<{ msg: string }>;
    expect(entries.some((entry) => entry.msg === 'fallback works')).toBe(true);
  });

  it('redacts headers.authorization regardless of header-name casing', async () => {
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    logger.info({ headers: { authorization: 'Bearer lower-case' } }, 'lower case header');
    logger.info({ headers: { Authorization: 'Bearer upper-case' } }, 'upper case header');

    const entries = lines() as Array<{ headers: Record<string, string> }>;
    expect(entries[0]?.headers.authorization).toBe('[REDACTED]');
    expect(entries[1]?.headers.Authorization).toBe('[REDACTED]');
  });

  it('does not crash when logging an object with a circular reference', async () => {
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    const circular: Record<string, unknown> = { name: 'circular' };
    circular.self = circular;

    expect(() => logger.info(circular, 'circular payload')).not.toThrow();
  });

  it('serializes errors with message but without a stack trace outside development', async () => {
    const { createLogger } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();

    const logger = createLogger('test-module', stream);
    logger.error({ err: new Error('boom') }, 'operation failed');

    const [entry] = lines() as Array<{ err: { message: string; stack?: string } }>;
    expect(entry?.err.message).toBe('boom');
    expect(entry?.err.stack).toBeUndefined();
  });
});

describe('resolveLogLevel', () => {
  it('returns the requested level when it is a valid Pino level', async () => {
    const { resolveLogLevel } = await import('../../../src/logging/logger.js');
    const { stream } = createCaptureStream();
    const pino = (await import('pino')).default;
    const baseLogger = pino(stream);

    expect(resolveLogLevel(baseLogger, 'debug')).toBe('debug');
  });

  it('falls back to info and logs a warning when the requested level is invalid', async () => {
    const { resolveLogLevel } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();
    const pino = (await import('pino')).default;
    const baseLogger = pino(stream);

    const level = resolveLogLevel(baseLogger, 'not-a-real-level');

    expect(level).toBe('info');
    const entries = lines() as Array<{ msg: string; requestedLevel: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toContain('Unknown LOG_LEVEL requested');
    expect(entries[0]?.requestedLevel).toBe('not-a-real-level');
  });

  it('falls back to info without warning when no level was requested at all', async () => {
    const { resolveLogLevel } = await import('../../../src/logging/logger.js');
    const { stream, lines } = createCaptureStream();
    const pino = (await import('pino')).default;
    const baseLogger = pino(stream);

    const level = resolveLogLevel(baseLogger, undefined);

    expect(level).toBe('info');
    expect(lines()).toHaveLength(0);
  });
});
