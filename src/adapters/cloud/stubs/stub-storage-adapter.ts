import type {
  ICloudStorageService,
  StorageDownloadResult,
  StorageUploadOptions,
} from '../interfaces/index.js';
import { StorageError } from '../interfaces/index.js';

interface StoredObject {
  data: Buffer;
  metadata?: Record<string, string>;
  contentType?: string;
}

/** In-memory ICloudStorageService for local development and testing. */
export class StubStorageAdapter implements ICloudStorageService {
  private readonly objects = new Map<string, StoredObject>();

  public async upload(key: string, data: Buffer, options?: StorageUploadOptions): Promise<void> {
    this.objects.set(key, { data, metadata: options?.metadata, contentType: options?.contentType });
  }

  public async download(key: string): Promise<StorageDownloadResult> {
    const object = this.objects.get(key);
    if (!object) {
      throw new StorageError(`Storage object not found: ${key}`, 'NOT_FOUND', 'local', 'download', key);
    }
    return { data: object.data, metadata: object.metadata, contentType: object.contentType };
  }

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async list(prefix?: string): Promise<string[]> {
    const keys = [...this.objects.keys()];
    return prefix === undefined ? keys : keys.filter((key) => key.startsWith(prefix));
  }

  public async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}
