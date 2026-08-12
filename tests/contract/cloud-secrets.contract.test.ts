import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AzureSecretsStub } from '../../src/adapters/cloud/azure/AzureSecretsStub.js';
import { GcpSecretsStub } from '../../src/adapters/cloud/gcp/GcpSecretsStub.js';
import type { ICloudSecretsService } from '../../src/adapters/cloud/interfaces/index.js';
import { ProviderNotImplementedError } from '../../src/adapters/cloud/interfaces/index.js';
import { LocalSecretsAdapter } from '../../src/adapters/cloud/local/LocalSecretsAdapter.js';

const silentLogger = pino({ level: 'silent' });
const MASTER_KEY_ENV_VAR = 'WALLY_CONTRACT_TEST_MASTER_KEY';

/**
 * WO-022: the same test logic runs against every ICloudSecretsService
 * implementation. Error *codes* differ deliberately by adapter (e.g.
 * LocalSecretsAdapter's SECRET_NOT_FOUND vs a generic NOT_FOUND) — the
 * shared contract only asserts that a missing/invalid secret rejects,
 * not the exact code, since CloudErrorCode intentionally allows
 * adapter-specific NOT_FOUND variants (see cloud-adapter.types.ts).
 */
export function runSecretsContractTests(
  name: string,
  createAdapter: () => ICloudSecretsService | Promise<ICloudSecretsService>,
  options: { expectNotImplemented?: boolean; afterEachCleanup?: () => Promise<void> } = {},
): void {
  describe(`ICloudSecretsService contract: ${name}`, () => {
    let adapter: ICloudSecretsService;

    beforeEach(async () => {
      adapter = await createAdapter();
    });

    afterEach(async () => {
      await options.afterEachCleanup?.();
    });

    if (options.expectNotImplemented) {
      it.each([
        ['getSecret', () => adapter.getSecret('name')],
        ['putSecret', () => adapter.putSecret('name', 'value')],
        ['rotateSecret', () => adapter.rotateSecret('name', 'new-value')],
        ['deleteSecret', () => adapter.deleteSecret('name')],
      ] as const)('%s() throws ProviderNotImplementedError', async (_method, call) => {
        await expect(call()).rejects.toBeInstanceOf(ProviderNotImplementedError);
      });
      return;
    }

    it('putSecret() then getSecret() round-trips the plaintext value', async () => {
      const secretName = `contract-secret-${name.replace(/\s+/g, '-')}`;
      const metadata = await adapter.putSecret(secretName, 'super-secret-value');

      expect(metadata.version).toBeTruthy();
      expect(metadata.createdAt).toBeInstanceOf(Date);
      await expect(adapter.getSecret(secretName)).resolves.toBe('super-secret-value');
    });

    it('rotateSecret() replaces the value and advances the version', async () => {
      const secretName = `contract-secret-rotate-${name.replace(/\s+/g, '-')}`;
      const initial = await adapter.putSecret(secretName, 'v1');
      const rotated = await adapter.rotateSecret(secretName, 'v2');

      expect(rotated.version).not.toBe(initial.version);
      expect(rotated.rotatedAt).toBeInstanceOf(Date);
      await expect(adapter.getSecret(secretName)).resolves.toBe('v2');
    });

    it('rotateSecret() on a secret that was never put rejects', async () => {
      await expect(adapter.rotateSecret(`never-put-${name.replace(/\s+/g, '-')}`, 'x')).rejects.toThrow();
    });

    it('getSecret() rejects for a name that was never put', async () => {
      await expect(adapter.getSecret(`never-put-2-${name.replace(/\s+/g, '-')}`)).rejects.toThrow();
    });

    it('deleteSecret() then getSecret() rejects — the secret is gone', async () => {
      const secretName = `contract-secret-delete-${name.replace(/\s+/g, '-')}`;
      await adapter.putSecret(secretName, 'to-be-deleted');
      await adapter.deleteSecret(secretName);
      await expect(adapter.getSecret(secretName)).rejects.toThrow();
    });

    it('deleteSecret() on a name that was never put does not throw (idempotent)', async () => {
      await expect(adapter.deleteSecret(`never-put-3-${name.replace(/\s+/g, '-')}`)).resolves.not.toThrow();
    });
  });
}

{
  let localFilePath: string | undefined;
  let localDir: string | undefined;
  process.env[MASTER_KEY_ENV_VAR] = 'a-strong-random-test-master-key-32chars+';

  runSecretsContractTests(
    'local (LocalSecretsAdapter)',
    async () => {
      localDir = await mkdtemp(join(tmpdir(), 'wally-secrets-contract-'));
      localFilePath = join(localDir, 'secrets.enc');
      return new LocalSecretsAdapter(localFilePath, MASTER_KEY_ENV_VAR, silentLogger);
    },
    { afterEachCleanup: async () => rm(localDir!, { recursive: true, force: true }) },
  );
}

// SecretsManagerAdapter (WO-019) is not yet merged as of this WO — an
// "aws (mocked SDK)" branch will be added alongside it. The registry-based
// factory design (src/adapters/cloud/factory.ts) means no changes will be
// needed here beyond adding that branch once the adapter exists.

runSecretsContractTests('gcp (GcpSecretsStub)', () => new GcpSecretsStub(), { expectNotImplemented: true });
runSecretsContractTests('azure (AzureSecretsStub)', () => new AzureSecretsStub(), { expectNotImplemented: true });
