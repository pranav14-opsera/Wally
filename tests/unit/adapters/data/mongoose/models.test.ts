import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

const VALID_ENV = {
  NODE_ENV: 'test',
  CLOUD_PROVIDER: 'local',
  DATA_ENGINE: 'mongo',
  COMPUTE_RUNNER: 'local',
  MONGO_URI: 'mongodb://localhost:27017',
  MONGO_INITDB_DATABASE: 'wally_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
  JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
  LOCAL_SECRETS_MASTER_KEY: 'a'.repeat(32),
  LOG_LEVEL: 'silent',
  AUDIT_LOG_RETENTION_DAYS: '90',
};

const EXPECTED_MODEL_NAMES = [
  'User',
  'AgentJob',
  'ToolRegistry',
  'MetricRegistry',
  'ConfigRegistry',
  'SpecRegistry',
  'AuditLog',
  'LoadTestResult',
];

describe('createModels', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('registers all 8 models on the given connection, keyed by the expected names', async () => {
    const { createModels } = await import('../../../../../src/adapters/data/mongoose/models.js');
    const modelFn = vi.fn((name: string) => ({ modelName: name }));
    const fakeConnection = { model: modelFn } as unknown as Parameters<typeof createModels>[0];

    const models = createModels(fakeConnection);

    for (const name of EXPECTED_MODEL_NAMES) {
      expect(modelFn).toHaveBeenCalledWith(name, expect.anything());
    }
    expect(Object.keys(models).sort()).toEqual([...EXPECTED_MODEL_NAMES].sort());
  });

  it("builds AuditLog's schema with a TTL index derived from AUDIT_LOG_RETENTION_DAYS", async () => {
    const { createModels } = await import('../../../../../src/adapters/data/mongoose/models.js');
    const calls: Array<[string, unknown]> = [];
    const modelFn: Mock = vi.fn((name: string, schema: unknown) => {
      calls.push([name, schema]);
      return { modelName: name };
    });
    const fakeConnection = { model: modelFn } as unknown as Parameters<typeof createModels>[0];

    createModels(fakeConnection);

    const auditLogCall = calls.find(([name]) => name === 'AuditLog');
    const SECONDS_PER_DAY = 86_400;
    const auditLogSchema = auditLogCall?.[1] as { indexes: () => Array<[Record<string, unknown>, Record<string, unknown>]> };
    const ttlIndex = auditLogSchema
      .indexes()
      .find(([fields]) => JSON.stringify(fields) === JSON.stringify({ created_at: 1 }));
    expect(ttlIndex?.[1]).toMatchObject({ expireAfterSeconds: 90 * SECONDS_PER_DAY });
  });
});
