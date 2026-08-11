import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_ENV = {
  NODE_ENV: 'test',
  CLOUD_PROVIDER: 'local',
  DATA_ENGINE: 'postgres',
  COMPUTE_RUNNER: 'local',
  POSTGRES_DB: 'wally_test',
  POSTGRES_USER: 'wally',
  POSTGRES_PASSWORD: 'test-password',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
  JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
  LOCAL_SECRETS_MASTER_KEY: 'a'.repeat(32),
  LOG_LEVEL: 'silent',
};

describe('prisma-client singleton', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('getPrismaClient returns the same instance on repeated calls', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
    const { getPrismaClient } = await import('../../../../../src/adapters/data/prisma/prisma-client.js');

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
  });

  it('disconnectPrismaClient clears the singleton so a later call creates a fresh instance', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
    const { getPrismaClient, disconnectPrismaClient } = await import(
      '../../../../../src/adapters/data/prisma/prisma-client.js'
    );

    const first = getPrismaClient();
    await disconnectPrismaClient();
    const second = getPrismaClient();

    expect(first).not.toBe(second);
    await disconnectPrismaClient();
  });

  it('disconnectPrismaClient is a no-op when no client has been created yet', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
    const { disconnectPrismaClient } = await import('../../../../../src/adapters/data/prisma/prisma-client.js');

    await expect(disconnectPrismaClient()).resolves.toBeUndefined();
  });

  it('throws a descriptive error naming the missing variable when required POSTGRES_* config is absent', async () => {
    // DATA_ENGINE=mongo makes POSTGRES_HOST legitimately optional at the
    // envSchema level, so getConfig() succeeds — this exercises
    // prisma-client's own defensive re-check of the postgres fields it
    // unconditionally needs, independent of which engine is selected.
    process.env = {
      ...ORIGINAL_ENV,
      ...VALID_ENV,
      DATA_ENGINE: 'mongo',
      MONGO_URI: 'mongodb://localhost:27017',
      MONGO_INITDB_DATABASE: 'wally_test',
    };
    delete process.env.POSTGRES_HOST;

    const { getPrismaClient } = await import('../../../../../src/adapters/data/prisma/prisma-client.js');

    expect(() => getPrismaClient()).toThrow(/POSTGRES_HOST/);
  });

  it('healthCheck returns false (does not throw) when the database is unreachable', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV, POSTGRES_PORT: '59999' };
    const { healthCheck, disconnectPrismaClient } = await import(
      '../../../../../src/adapters/data/prisma/prisma-client.js'
    );

    await expect(healthCheck()).resolves.toBe(false);
    await disconnectPrismaClient();
  }, 15_000);
});
