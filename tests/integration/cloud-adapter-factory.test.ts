import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCloudAdapters } from '../../src/adapters/cloud/index.js';
import { localProviderEnv } from '../fixtures/cloud-factory/env-configs.fixture.js';

/**
 * WO-022 AC: "Factory integration test validates that createCloudAdapters
 * returns working adapters for CLOUD_PROVIDER=local with real filesystem
 * and encryption operations." No mocking here — real FilesystemStorageAdapter
 * and LocalSecretsAdapter instances, backed by a real temp directory on disk.
 */
describe('createCloudAdapters integration (CLOUD_PROVIDER=local)', () => {
  const ORIGINAL_ENV = process.env;
  const STORAGE_PATH = join(tmpdir(), `wally-factory-integration-${randomUUID()}`);
  const SECRETS_PATH = join(tmpdir(), `wally-factory-integration-secrets-${randomUUID()}.enc`);

  beforeAll(() => {
    process.env = {
      ...ORIGINAL_ENV,
      ...localProviderEnv,
      STORAGE_LOCAL_PATH: STORAGE_PATH,
      SECRETS_LOCAL_PATH: SECRETS_PATH,
    };
  });

  afterAll(async () => {
    process.env = ORIGINAL_ENV;
    await rm(STORAGE_PATH, { recursive: true, force: true });
    await rm(SECRETS_PATH, { force: true });
  });

  it('storage adapter performs a real upload/download round-trip against disk', async () => {
    const { storage } = createCloudAdapters();

    await storage.upload('integration/report.json', Buffer.from('{"ok":true}'), {
      contentType: 'application/json',
    });

    const result = await storage.download('integration/report.json');
    expect(result.data.toString()).toBe('{"ok":true}');
    expect(result.contentType).toBe('application/json');
  });

  it('secrets adapter performs a real put/get round-trip with AES-256-GCM encryption on disk', async () => {
    const { secrets } = createCloudAdapters();

    await secrets.putSecret('integration-test-secret', 'plaintext-value');
    await expect(secrets.getSecret('integration-test-secret')).resolves.toBe('plaintext-value');
  });

  it('compute adapter resolves to a real LocalComputeRunner instance (no k6 task run — that is LocalComputeRunner\'s own suite)', () => {
    const { compute } = createCloudAdapters();
    expect(compute).toBeDefined();
    expect(typeof compute.runTask).toBe('function');
  });
});
