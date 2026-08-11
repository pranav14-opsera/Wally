import type { ICloudSecretsService } from '../interfaces.js';
import { SecretNotFoundError } from '../interfaces.js';

/** In-memory ICloudSecretsService for local development and testing. */
export class StubSecretsAdapter implements ICloudSecretsService {
  private readonly secrets = new Map<string, string>();

  public async getSecret(key: string): Promise<string> {
    const value = this.secrets.get(key);
    if (value === undefined) {
      throw new SecretNotFoundError(key);
    }
    return value;
  }

  public async putSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  public async rotateSecret(key: string, newValue: string): Promise<void> {
    if (!this.secrets.has(key)) {
      throw new SecretNotFoundError(key);
    }
    this.secrets.set(key, newValue);
  }

  public async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  public async listSecrets(): Promise<string[]> {
    return [...this.secrets.keys()];
  }
}
