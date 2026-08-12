import { createStubMethod } from '../not-implemented.js';
import type { ICloudSecretsService, SecretMetadata } from '../interfaces/index.js';

const PROVIDER = 'azure';
const BACKING_SERVICE = 'Azure Key Vault';

/**
 * TODO(WO-021 follow-up): implement against Azure Key Vault.
 * - SDK: @azure/keyvault-secrets
 * - Config: AZURE_KEY_VAULT_URL, managed identity or AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID
 * - putSecret/rotateSecret map to SecretClient#setSecret (Key Vault versions secrets automatically)
 * - getSecret maps to #getSecret
 * - deleteSecret maps to #beginDeleteSecret
 */
export class AzureSecretsStub implements ICloudSecretsService {
  public getSecret: (name: string) => Promise<string> = createStubMethod(PROVIDER, 'getSecret', BACKING_SERVICE);

  public putSecret: (name: string, value: string) => Promise<SecretMetadata> = createStubMethod(
    PROVIDER,
    'putSecret',
    BACKING_SERVICE,
  );

  public rotateSecret: (name: string, newValue: string) => Promise<SecretMetadata> = createStubMethod(
    PROVIDER,
    'rotateSecret',
    BACKING_SERVICE,
  );

  public deleteSecret: (name: string) => Promise<void> = createStubMethod(PROVIDER, 'deleteSecret', BACKING_SERVICE);
}
