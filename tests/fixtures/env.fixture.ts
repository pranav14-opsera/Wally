/**
 * Factory functions producing `process.env`-shaped objects for testing
 * `src/config/loader.ts`. See tests/fixtures/README.md for the fixture
 * conventions this file follows.
 */

const VALID_LOCAL_SECRETS_MASTER_KEY = 'a'.repeat(32);

export function createValidPostgresEnv(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
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
    LOCAL_SECRETS_MASTER_KEY: VALID_LOCAL_SECRETS_MASTER_KEY,
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    PORT: '3000',
    ...overrides,
  };
}

export function createValidMongoEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CLOUD_PROVIDER: 'local',
    DATA_ENGINE: 'mongo',
    COMPUTE_RUNNER: 'local',
    MONGO_URI: 'mongodb://localhost:27017',
    MONGO_INITDB_DATABASE: 'wally_test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
    JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
    LOCAL_SECRETS_MASTER_KEY: VALID_LOCAL_SECRETS_MASTER_KEY,
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    PORT: '3000',
    ...overrides,
  };
}

/**
 * Only the variables with defaults/required-regardless-of-engine values —
 * relies on schema defaults for CLOUD_PROVIDER/DATA_ENGINE/COMPUTE_RUNNER/
 * LOG_LEVEL/NODE_ENV/PORT, and on CLOUD_PROVIDER defaulting to 'local' to
 * require LOCAL_SECRETS_MASTER_KEY, and DATA_ENGINE defaulting to
 * 'postgres' to require the POSTGRES_* vars.
 */
export function createMinimalLocalEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    POSTGRES_DB: 'wally_test',
    POSTGRES_USER: 'wally',
    POSTGRES_PASSWORD: 'test-password',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5432',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
    JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
    LOCAL_SECRETS_MASTER_KEY: VALID_LOCAL_SECRETS_MASTER_KEY,
    ...overrides,
  };
}

export function createInvalidEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CLOUD_PROVIDER: 'not-a-real-provider',
    DATA_ENGINE: 'postgres',
    POSTGRES_PORT: 'not-a-number',
    REDIS_URL: '',
    JWT_PRIVATE_KEY_PATH: '',
    JWT_PUBLIC_KEY_PATH: '',
    ...overrides,
  };
}
