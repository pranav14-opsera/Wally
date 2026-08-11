import { beforeEach, describe, expect, it, vi } from 'vitest';

// NOTE: uses a relative import rather than the @config path alias.
// vite-tsconfig-paths (via vite-node, which powers Vitest) fails to
// resolve the @config/* alias specifically — every other alias
// (@auth, @logging, @gateway, @registries) resolves correctly, only
// @config does not, even after clearing node_modules/.vite. This is a
// tooling quirk unrelated to this module's code; relative imports are a
// reliable, valid alternative and don't require changing the WO-001-owned
// tsconfig path alias definitions.
import type { IConfigProvider } from '../../../src/config/index.js';
import { loadConfig } from '../../../src/config/index.js';
import {
  createInvalidEnv,
  createMinimalLocalEnv,
  createValidMongoEnv,
  createValidPostgresEnv,
} from '../../fixtures/env.fixture.js';

describe('loadConfig', () => {
  it('parses a valid postgres environment', () => {
    const config = loadConfig(createValidPostgresEnv());

    expect(config.DATA_ENGINE).toBe('postgres');
    expect(config.POSTGRES_DB).toBe('wally_test');
    expect(config.POSTGRES_PORT).toBe(5432);
  });

  it('parses a valid mongo environment', () => {
    const config = loadConfig(createValidMongoEnv());

    expect(config.DATA_ENGINE).toBe('mongo');
    expect(config.MONGO_URI).toBe('mongodb://localhost:27017');
    expect(config.MONGO_INITDB_DATABASE).toBe('wally_test');
  });

  it('throws a descriptive error for an invalid CLOUD_PROVIDER enum value', () => {
    expect(() => loadConfig(createValidPostgresEnv({ CLOUD_PROVIDER: 'not-a-real-provider' })))
      .toThrowError(/CLOUD_PROVIDER/);
  });

  it('reports every missing/invalid variable in a single error, not just the first', () => {
    let thrown: Error | undefined;
    try {
      loadConfig(createInvalidEnv());
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown?.message).toContain('CLOUD_PROVIDER');
    expect(thrown?.message).toContain('POSTGRES_PORT');
    expect(thrown?.message).toContain('REDIS_URL');
    expect(thrown?.message).toContain('JWT_PRIVATE_KEY_PATH');
  });

  it('does not require POSTGRES_* variables when DATA_ENGINE=mongo', () => {
    const env = createValidMongoEnv();
    delete env.POSTGRES_HOST;
    delete env.POSTGRES_USER;
    delete env.POSTGRES_PASSWORD;
    delete env.POSTGRES_DB;
    delete env.POSTGRES_PORT;

    expect(() => loadConfig(env)).not.toThrow();
  });

  it('does not require MONGO_* variables when DATA_ENGINE=postgres', () => {
    const env = createValidPostgresEnv();
    delete env.MONGO_URI;
    delete env.MONGO_INITDB_DATABASE;

    expect(() => loadConfig(env)).not.toThrow();
  });

  it('accepts unused engine variables without error when the other engine is selected', () => {
    const env = createValidPostgresEnv({
      MONGO_URI: 'mongodb://localhost:27017',
      MONGO_INITDB_DATABASE: 'unused',
    });

    expect(() => loadConfig(env)).not.toThrow();
  });

  it('applies default values when optional variables with defaults are omitted', () => {
    const config = loadConfig(createMinimalLocalEnv());

    expect(config.CLOUD_PROVIDER).toBe('local');
    expect(config.DATA_ENGINE).toBe('postgres');
    expect(config.COMPUTE_RUNNER).toBe('local');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
  });

  it('coerces PORT and POSTGRES_PORT from string to number', () => {
    const config = loadConfig(createValidPostgresEnv({ PORT: '8080', POSTGRES_PORT: '5433' }));

    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
    expect(config.POSTGRES_PORT).toBe(5433);
    expect(typeof config.POSTGRES_PORT).toBe('number');
  });

  it('treats empty-string required variables as missing', () => {
    expect(() => loadConfig(createValidPostgresEnv({ REDIS_URL: '' }))).toThrowError(/REDIS_URL/);
  });

  it('requires LOCAL_SECRETS_MASTER_KEY to be at least 32 characters when CLOUD_PROVIDER=local', () => {
    expect(() =>
      loadConfig(createValidPostgresEnv({ LOCAL_SECRETS_MASTER_KEY: 'too-short' })),
    ).toThrowError(/LOCAL_SECRETS_MASTER_KEY/);
  });

  it('accepts every standard Pino log level', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

    for (const level of levels) {
      expect(() => loadConfig(createValidPostgresEnv({ LOG_LEVEL: level }))).not.toThrow();
    }
  });
});

describe('getConfig', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ...createValidPostgresEnv() };
    vi.resetModules();
  });

  it('caches the parsed config across calls (singleton behavior)', async () => {
    const { getConfig: freshGetConfig } = await import('../../../src/config/index.js');

    const first = freshGetConfig();
    const second = freshGetConfig();

    expect(first).toBe(second);
  });

  it('reflects the environment present at first call, not at each call', async () => {
    const { getConfig: freshGetConfig } = await import('../../../src/config/index.js');

    const first = freshGetConfig();
    process.env.PORT = '9999';
    const second = freshGetConfig();

    expect(first.PORT).toBe(second.PORT);
  });
});

describe('IConfigProvider', () => {
  it('type-checks an implementation with the expected method signatures', () => {
    const provider: IConfigProvider = {
      getConfigValue: async (key: string) => `value-for-${key}`,
      getAllConfig: async () => ({ EXAMPLE: 'value' }),
    };

    expect(typeof provider.getConfigValue).toBe('function');
    expect(typeof provider.getAllConfig).toBe('function');
  });
});
