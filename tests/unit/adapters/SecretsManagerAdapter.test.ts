import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { SecretsError } from '../../../src/adapters/cloud/index.js';
import { SecretsManagerAdapter } from '../../../src/adapters/cloud/aws/SecretsManagerAdapter.js';
import {
  accessDeniedError,
  createSecretResponse,
  credentialsProviderError,
  DeleteSecretCommand,
  DescribeSecretCommand,
  deleteSecretResponse,
  describeSecretResponse,
  fakeSecretArn,
  GetSecretValueCommand,
  getSecretValueResponse,
  internalServiceError,
  invalidRequestError,
  PutSecretValueCommand,
  putSecretValueResponse,
  resourceExistsError,
  resourceNotFoundError,
  RestoreSecretCommand,
  restoreSecretResponse,
  throttlingError,
} from '../../fixtures/aws/secrets-manager-responses.js';

const NAMESPACE = 'wally-test/';
const silentLogger = pino({ level: 'silent' });

/** A minimal mocked SecretsManagerClient: only `.send()` is used by the adapter, so only that needs mocking. */
function createMockClient(): { send: Mock } {
  return { send: vi.fn() };
}

function newAdapter(client: { send: Mock }, forceDeleteWithoutRecovery = false): SecretsManagerAdapter {
  return new SecretsManagerAdapter(NAMESPACE, forceDeleteWithoutRecovery, silentLogger, client as never);
}

describe('SecretsManagerAdapter', () => {
  let client: { send: Mock };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('namespace prefixing', () => {
    it('prepends the configured namespace to every secret name sent to AWS', async () => {
      client.send.mockResolvedValue(getSecretValueResponse(`${NAMESPACE}db-password`, 'hunter2'));
      const adapter = newAdapter(client);

      await adapter.getSecret('db-password');

      const command = client.send.mock.calls[0]?.[0] as GetSecretValueCommand;
      expect(command).toBeInstanceOf(GetSecretValueCommand);
      expect(command.input.SecretId).toBe(`${NAMESPACE}db-password`);
    });

    it('throws INVALID_ARGUMENT when the namespaced name exceeds the 512-character limit', async () => {
      const adapter = newAdapter(client);
      const longName = 'x'.repeat(600);

      await expect(adapter.getSecret(longName)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      expect(client.send).not.toHaveBeenCalled();
    });
  });

  describe('getSecret', () => {
    it('returns the decrypted SecretString', async () => {
      client.send.mockResolvedValue(getSecretValueResponse(`${NAMESPACE}api-key`, 'super-secret-value'));
      const adapter = newAdapter(client);

      const value = await adapter.getSecret('api-key');

      expect(value).toBe('super-secret-value');
    });

    it('maps ResourceNotFoundException to SECRET_NOT_FOUND', async () => {
      client.send.mockRejectedValue(resourceNotFoundError());
      const adapter = newAdapter(client);

      const rejection = adapter.getSecret('missing-secret');
      await expect(rejection).rejects.toBeInstanceOf(SecretsError);
      await expect(rejection).rejects.toMatchObject({ code: 'SECRET_NOT_FOUND', secretName: 'missing-secret' });
    });

    it('throws INVALID_ARGUMENT when the response has no SecretString (binary secret)', async () => {
      client.send.mockResolvedValue({ ARN: fakeSecretArn('bin'), Name: `${NAMESPACE}bin`, VersionId: 'v1' });
      const adapter = newAdapter(client);

      await expect(adapter.getSecret('bin')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });

  describe('putSecret', () => {
    it('creates a new secret via CreateSecretCommand when it does not already exist', async () => {
      client.send.mockResolvedValueOnce(createSecretResponse(`${NAMESPACE}new-secret`));
      const adapter = newAdapter(client);

      const metadata = await adapter.putSecret('new-secret', 'value-1');

      expect(metadata.version).toBe('version-1');
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('falls back to PutSecretValueCommand when CreateSecretCommand reports ResourceExistsException', async () => {
      client.send
        .mockRejectedValueOnce(resourceExistsError())
        .mockResolvedValueOnce(putSecretValueResponse(`${NAMESPACE}existing-secret`));
      const adapter = newAdapter(client);

      const metadata = await adapter.putSecret('existing-secret', 'value-2');

      expect(metadata.version).toBe('version-2');
      expect(client.send).toHaveBeenCalledTimes(2);
      const putCommand = client.send.mock.calls[1]?.[0] as PutSecretValueCommand;
      expect(putCommand).toBeInstanceOf(PutSecretValueCommand);
    });

    it('restores a secret pending deletion and retries once when PutSecretValueCommand reports InvalidRequestException', async () => {
      client.send
        .mockRejectedValueOnce(resourceExistsError()) // create fails: already exists
        .mockRejectedValueOnce(invalidRequestError()) // put fails: pending deletion
        .mockResolvedValueOnce(restoreSecretResponse(`${NAMESPACE}restorable`)) // restore succeeds
        .mockResolvedValueOnce(putSecretValueResponse(`${NAMESPACE}restorable`)); // retry succeeds
      const adapter = newAdapter(client);

      const metadata = await adapter.putSecret('restorable', 'value-3');

      expect(metadata.version).toBe('version-2');
      expect(client.send).toHaveBeenCalledTimes(4);
      const restoreCommand = client.send.mock.calls[2]?.[0] as RestoreSecretCommand;
      expect(restoreCommand).toBeInstanceOf(RestoreSecretCommand);
    });

    it('propagates a mapped error when the restore itself fails', async () => {
      client.send
        .mockRejectedValueOnce(resourceExistsError())
        .mockRejectedValueOnce(invalidRequestError())
        .mockRejectedValueOnce(internalServiceError());
      const adapter = newAdapter(client);

      await expect(adapter.putSecret('unrestorable', 'value')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });

    it('maps a non-ResourceExistsException CreateSecretCommand failure directly, without attempting a fallback', async () => {
      client.send.mockRejectedValueOnce(accessDeniedError());
      const adapter = newAdapter(client);

      await expect(adapter.putSecret('denied', 'value')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      expect(client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('rotateSecret', () => {
    it('verifies existence via DescribeSecretCommand, then writes a new version', async () => {
      client.send
        .mockResolvedValueOnce(describeSecretResponse(`${NAMESPACE}rotatable`))
        .mockResolvedValueOnce(putSecretValueResponse(`${NAMESPACE}rotatable`));
      const adapter = newAdapter(client);

      const metadata = await adapter.rotateSecret('rotatable', 'new-value');

      expect(metadata.version).toBe('version-2');
      expect(metadata.rotatedAt).toBeInstanceOf(Date);
      const describeCommand = client.send.mock.calls[0]?.[0] as DescribeSecretCommand;
      expect(describeCommand).toBeInstanceOf(DescribeSecretCommand);
    });

    it('throws SECRET_NOT_FOUND without attempting to write when the secret does not exist', async () => {
      client.send.mockRejectedValueOnce(resourceNotFoundError());
      const adapter = newAdapter(client);

      await expect(adapter.rotateSecret('never-created', 'value')).rejects.toMatchObject({ code: 'SECRET_NOT_FOUND' });
      expect(client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteSecret', () => {
    it('deletes with the configured ForceDeleteWithoutRecovery flag', async () => {
      client.send.mockResolvedValue(deleteSecretResponse(`${NAMESPACE}deletable`));
      const adapter = newAdapter(client, true);

      await adapter.deleteSecret('deletable');

      const command = client.send.mock.calls[0]?.[0] as DeleteSecretCommand;
      expect(command).toBeInstanceOf(DeleteSecretCommand);
      expect(command.input.ForceDeleteWithoutRecovery).toBe(true);
    });

    it('defaults ForceDeleteWithoutRecovery to false (safe recovery window) when not overridden', async () => {
      client.send.mockResolvedValue(deleteSecretResponse(`${NAMESPACE}deletable`));
      const adapter = newAdapter(client);

      await adapter.deleteSecret('deletable');

      const command = client.send.mock.calls[0]?.[0] as DeleteSecretCommand;
      expect(command.input.ForceDeleteWithoutRecovery).toBe(false);
    });

    it('is idempotent — resolves without throwing when the secret does not exist', async () => {
      client.send.mockRejectedValue(resourceNotFoundError());
      const adapter = newAdapter(client);

      await expect(adapter.deleteSecret('already-gone')).resolves.toBeUndefined();
    });
  });

  describe('mapAwsError', () => {
    it('maps AccessDeniedException to PERMISSION_DENIED', async () => {
      client.send.mockRejectedValue(accessDeniedError());
      await expect(newAdapter(client).getSecret('x')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('maps ThrottlingException to RATE_LIMITED', async () => {
      client.send.mockRejectedValue(throttlingError());
      await expect(newAdapter(client).getSecret('x')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('maps CredentialsProviderError to CONFIGURATION_ERROR', async () => {
      client.send.mockRejectedValue(credentialsProviderError());
      await expect(newAdapter(client).getSecret('x')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    });

    it('maps an unrecognized AWS error to PROVIDER_ERROR as a fallback', async () => {
      client.send.mockRejectedValue(internalServiceError());
      await expect(newAdapter(client).getSecret('x')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });

    it('every mapped SecretsError carries the secret name, never the secret value, in its message', async () => {
      const secretValue = 'THIS-MUST-NEVER-APPEAR-IN-AN-ERROR-MESSAGE';
      client.send
        .mockRejectedValueOnce(resourceExistsError())
        .mockRejectedValueOnce(internalServiceError(`failure while processing ${secretValue.length} bytes`));
      const adapter = newAdapter(client);

      let thrown: SecretsError | undefined;
      try {
        await adapter.putSecret('leaky', secretValue);
        expect.unreachable('should have thrown');
      } catch (error) {
        thrown = error as SecretsError;
      }

      expect(thrown).toBeInstanceOf(SecretsError);
      expect(thrown?.secretName).toBe('leaky');
      expect(thrown?.message).not.toContain(secretValue);
      expect(JSON.stringify(thrown?.toJSON())).not.toContain(secretValue);
    });
  });

  describe('constructor', () => {
    it('creates a default SecretsManagerClient when none is injected, without throwing (relies on the SDK default credential/region provider chain)', () => {
      expect(() => new SecretsManagerAdapter(NAMESPACE, false, silentLogger)).not.toThrow();
    });
  });
});
