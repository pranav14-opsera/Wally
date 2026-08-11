import type { SecretMetadata } from './cloud-adapter.types.js';

export interface ICloudSecretsService {
  /** Returns the plaintext value. Callers must never log the resolved value. */
  getSecret(name: string): Promise<string>;
  putSecret(name: string, value: string): Promise<SecretMetadata>;
  rotateSecret(name: string, newValue: string): Promise<SecretMetadata>;
  deleteSecret(name: string): Promise<void>;
  /**
   * Optional one-time startup hook (e.g. LocalSecretsAdapter's JWT RS256
   * key-pair auto-generation). Not every implementation needs it —
   * bootstrap.ts calls it via `cloudSecrets.init?.()`.
   */
  init?(): Promise<void>;
}
