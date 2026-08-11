import type { ICloudStorageService } from '../interfaces.js';
import { StorageObjectNotFoundError } from '../interfaces.js';

interface StoredObject {
  data: Buffer;
  metadata?: Record<string, string>;
}

/** In-memory ICloudStorageService for local development and testing. */
export class StubStorageAdapter implements ICloudStorageService {
  private readonly objects = new Map<string, StoredObject>();

  public async upload(
    key: string,
    data: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void> {
    this.objects.set(key, { data, metadata });
  }

  public async download(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) {
      throw new StorageObjectNotFoundError(key);
    }
    return object.data;
  }

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }

  public async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}
