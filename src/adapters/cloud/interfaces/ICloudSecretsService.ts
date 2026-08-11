import type { SecretMetadata } from './cloud-adapter.types.js';

export interface ICloudSecretsService {
  /** Returns the plaintext value. Callers must never log the resolved value. */
  getSecret(name: string): Promise<string>;
  putSecret(name: string, value: string): Promise<SecretMetadata>;
  rotateSecret(name: string, newValue: string): Promise<SecretMetadata>;
  deleteSecret(name: string): Promise<void>;
}
