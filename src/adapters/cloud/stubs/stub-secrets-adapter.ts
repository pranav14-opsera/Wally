import { randomUUID } from 'node:crypto';

import type { ICloudSecretsService, SecretMetadata } from '../interfaces/index.js';
import { SecretsError } from '../interfaces/index.js';

interface StoredSecret {
  value: string;
  metadata: SecretMetadata;
}

/** In-memory ICloudSecretsService for local development and testing. */
export class StubSecretsAdapter implements ICloudSecretsService {
  private readonly secrets = new Map<string, StoredSecret>();

  public async getSecret(name: string): Promise<string> {
    const secret = this.secrets.get(name);
    if (!secret) {
      throw new SecretsError(`Secret not found: ${name}`, 'NOT_FOUND', 'local', 'getSecret', name);
    }
    return secret.value;
  }

  public async putSecret(name: string, value: string): Promise<SecretMetadata> {
    const metadata: SecretMetadata = { version: randomUUID(), createdAt: new Date() };
    this.secrets.set(name, { value, metadata });
    return metadata;
  }

  public async rotateSecret(name: string, newValue: string): Promise<SecretMetadata> {
    const existing = this.secrets.get(name);
    if (!existing) {
      throw new SecretsError(`Secret not found: ${name}`, 'NOT_FOUND', 'local', 'rotateSecret', name);
    }

    const metadata: SecretMetadata = {
      version: randomUUID(),
      createdAt: existing.metadata.createdAt,
      rotatedAt: new Date(),
    };
    this.secrets.set(name, { value: newValue, metadata });
    return metadata;
  }

  public async deleteSecret(name: string): Promise<void> {
    this.secrets.delete(name);
  }
}
