import { generateKeyPairSync } from 'node:crypto';

import bcrypt from 'bcryptjs';
import pino from 'pino';

import type { User } from '../../src/adapters/data/index.js';
import type { GatewayContainer } from '../../src/gateway/types.js';

// Generated once per test process, not per call — RS256 key generation
// is expensive (~100ms+) and every test that builds a fake container
// would otherwise pay that cost again.
const TEST_KEY_PAIR = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** In-memory `ICloudSecretsService` fake — enough for `JwtService.init()` to load a real, working RS256 key pair without touching a real secrets store. */
function fakeCloudSecrets(): GatewayContainer['cloudSecrets'] {
  const secrets = new Map<string, string>([
    ['jwt-signing-key-private', TEST_KEY_PAIR.privateKey],
    ['jwt-signing-key-public', TEST_KEY_PAIR.publicKey],
  ]);

  return {
    getSecret: async (name: string) => {
      const value = secrets.get(name);
      if (value === undefined) {
        throw new Error(`fakeCloudSecrets: no secret named "${name}"`);
      }
      return value;
    },
    putSecret: async (name, value) => {
      secrets.set(name, value);
      return { version: '1', createdAt: new Date() };
    },
    rotateSecret: async (name, value) => {
      secrets.set(name, value);
      return { version: '2', createdAt: new Date(), rotatedAt: new Date() };
    },
    deleteSecret: async (name) => {
      secrets.delete(name);
    },
  };
}

/** In-memory `IRepository<User>` fake — only the methods the auth module actually calls (`findMany`, `findById`) are implemented; everything else throws if exercised, so a test relying on unimplemented behavior fails loudly instead of silently returning nothing. */
export function fakeUserRepository(users: User[] = []): GatewayContainer['dataAdapter']['repositories']['users'] {
  const notImplemented = (method: string) => () => {
    throw new Error(`fakeUserRepository.${method} is not implemented`);
  };

  return {
    findById: async (id) => users.find((user) => user.id === id) ?? null,
    findMany: async (filters) => {
      const emailFilter = filters?.email;
      const matched =
        emailFilter?.operator === 'eq' ? users.filter((user) => user.email === emailFilter.value) : users;
      return { items: matched, total: matched.length, hasNext: false };
    },
    create: notImplemented('create'),
    createMany: notImplemented('createMany'),
    update: notImplemented('update'),
    delete: notImplemented('delete'),
    count: notImplemented('count'),
    transaction: notImplemented('transaction'),
  };
}

/** Bare-minimum `IRepository<T>` fake for repositories a test doesn't specifically exercise — every method throws loudly if actually called, rather than silently returning nothing. */
function fakeSimpleRepository() {
  const notImplemented = (method: string) => () => {
    throw new Error(`fakeSimpleRepository.${method} is not implemented`);
  };
  return {
    findById: notImplemented('findById'),
    findMany: notImplemented('findMany'),
    create: notImplemented('create'),
    createMany: notImplemented('createMany'),
    update: notImplemented('update'),
    delete: notImplemented('delete'),
    count: notImplemented('count'),
    transaction: notImplemented('transaction'),
  };
}

export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: crypto.randomUUID(),
    email: 'admin@wally.test',
    name: 'Test Admin',
    password_hash: bcrypt.hashSync('correct-horse-battery-staple', 4),
    role: 'admin',
    is_locked: false,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/** Minimal fake `AppContainer` for gateway plugin/route tests — every adapter field is an inert stand-in unless a test specifically wires one up (pass `users` to seed the fake user repository, `healthCheck` to simulate a down database for WO-046 tests). */
export function fakeGatewayContainer(
  overrides: Partial<GatewayContainer['config']> = {},
  users: User[] = [],
  healthCheck: () => Promise<boolean> = async () => true,
): GatewayContainer {
  return {
    config: {
      CLOUD_PROVIDER: 'local',
      DATA_ENGINE: 'postgres',
      COMPUTE_RUNNER: 'local',
      REDIS_URL: 'redis://localhost:6379',
      JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
      JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      PORT: 0,
      HOST: '127.0.0.1',
      SHUTDOWN_TIMEOUT_MS: 10_000,
      STORAGE_LOCAL_PATH: './data/storage',
      SECRETS_LOCAL_PATH: './data/secrets.enc',
      K6_BINARY_PATH: 'k6',
      COMPUTE_TASK_TIMEOUT_MS: 600_000,
      COMPUTE_GRACE_PERIOD_MS: 10_000,
      COMPUTE_TASK_RETENTION_MS: 3_600_000,
      AUDIT_LOG_RETENTION_DAYS: 365,
      SECRETS_NAMESPACE: 'wally/',
      SECRETS_FORCE_DELETE_WITHOUT_RECOVERY: false,
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      CSP_DIRECTIVES: undefined,
      BCRYPT_SALT_ROUNDS: 4,
      AUTH_MIN_PASSWORD_LENGTH: 12,
      HEALTH_CHECK_TIMEOUT_MS: 1_000,
      LOADTEST_NAME_MAX_LENGTH: 100,
      LOADTEST_MAX_VUS: 1_000,
      LOADTEST_MAX_DURATION_SECONDS: 3_600,
      LOADTEST_DEFAULT_VUS: 10,
      LOADTEST_DEFAULT_DURATION_SECONDS: 30,
      LOADTEST_DEFAULT_P95_THRESHOLD_MS: 500,
      LOADTEST_DEFAULT_ERROR_RATE_PCT: 1,
      LOADTEST_PROGRESS_INTERVAL_MS: 2_000,
      LOADTEST_STDERR_TAIL_LENGTH: 2_000,
      AGENT_MIN_STEP_DURATION_MS: 0,
      TOOL_NAME_MAX_LENGTH: 100,
      SPEC_API_KEY_MAX_LENGTH: 200,
      SPEC_FETCH_TIMEOUT_MS: 5_000,
      SPEC_MAX_ENDPOINTS_TO_SHOW: 20,
      SPEC_SUMMARY_MAX_LENGTH: 140,
      SPEC_RESPONSE_SHAPE_MAX_FIELDS: 10,
      API_LIFECYCLE_MAX_ENDPOINTS_TO_DIFF: 5_000,
      ...overrides,
    },
    logger: pino({ level: 'silent' }),
    auditLogger: { logAuth: async () => {}, logMutation: async () => {}, logAccessControl: async () => {} },
    cloudStorage: {} as GatewayContainer['cloudStorage'],
    cloudSecrets: fakeCloudSecrets(),
    cloudCompute: {} as GatewayContainer['cloudCompute'],
    dataAdapter: {
      engine: 'postgres',
      repositories: {
        users: fakeUserRepository(users),
        toolRegistry: fakeSimpleRepository(),
        specRegistry: fakeSimpleRepository(),
      } as never,
      disconnect: async () => {},
      healthCheck,
    },
  };
}
