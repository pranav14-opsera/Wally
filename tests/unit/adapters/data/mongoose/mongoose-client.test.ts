import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_ENV = {
  NODE_ENV: 'test',
  CLOUD_PROVIDER: 'local',
  DATA_ENGINE: 'mongo',
  COMPUTE_RUNNER: 'local',
  MONGO_URI: 'mongodb://localhost:59999',
  MONGO_INITDB_DATABASE: 'wally_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
  JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
  LOCAL_SECRETS_MASTER_KEY: 'a'.repeat(32),
  LOG_LEVEL: 'silent',
};

describe('mongoose-client', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it(
    'getMongooseConnection rejects when no MongoDB is reachable at the configured URI',
    async () => {
      process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
      const { getMongooseConnection } = await import('../../../../../src/adapters/data/mongoose/mongoose-client.js');

      await expect(getMongooseConnection()).rejects.toThrow();
    },
    15_000,
  );

  it(
    'healthCheck returns false (does not throw) when the database is unreachable',
    async () => {
      process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
      const { healthCheck } = await import('../../../../../src/adapters/data/mongoose/mongoose-client.js');

      await expect(healthCheck()).resolves.toBe(false);
    },
    15_000,
  );

  it('throws a descriptive error naming the missing variables when MONGO_URI/MONGO_INITDB_DATABASE are absent', async () => {
    // DATA_ENGINE=postgres makes MONGO_URI legitimately optional at the
    // envSchema level, so getConfig() succeeds — this exercises
    // mongoose-client's own defensive re-check of the mongo fields it
    // unconditionally needs, independent of which engine is selected.
    process.env = {
      ...ORIGINAL_ENV,
      ...VALID_ENV,
      DATA_ENGINE: 'postgres',
      POSTGRES_DB: 'wally_test',
      POSTGRES_USER: 'wally',
      POSTGRES_PASSWORD: 'test-password',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
    };
    delete process.env.MONGO_URI;

    const { getMongooseConnection } = await import('../../../../../src/adapters/data/mongoose/mongoose-client.js');

    await expect(getMongooseConnection()).rejects.toThrow(/MONGO_URI/);
  });
});
