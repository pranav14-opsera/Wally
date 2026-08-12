import { createStubMethod } from '../not-implemented.js';
import type { ICloudSecretsService, SecretMetadata } from '../interfaces/index.js';

const PROVIDER = 'gcp';
const BACKING_SERVICE = 'Google Secret Manager';

/**
 * TODO(WO-021 follow-up): implement against Google Secret Manager.
 * - SDK: @google-cloud/secret-manager
 * - Config: GOOGLE_APPLICATION_CREDENTIALS (or workload identity), GCP_PROJECT_ID
 * - putSecret/rotateSecret map to SecretManagerServiceClient#addSecretVersion
 * - getSecret maps to #accessSecretVersion
 * - deleteSecret maps to #deleteSecret
 */
export class GcpSecretsStub implements ICloudSecretsService {
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
