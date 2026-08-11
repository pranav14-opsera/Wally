import type { StorageDownloadResult, StorageUploadOptions } from './cloud-adapter.types.js';

/**
 * Buffered (not streaming) upload/download for now — every current
 * consumer (spec files, k6 result artifacts, audit archives) is small
 * enough to hold in memory. Add a streaming overload if a future WO
 * needs to move large objects without buffering the whole payload.
 */
export interface ICloudStorageService {
  upload(key: string, data: Buffer, options?: StorageUploadOptions): Promise<void>;
  download(key: string): Promise<StorageDownloadResult>;
  delete(key: string): Promise<void>;
  /** Omit `prefix` to list every key. */
  list(prefix?: string): Promise<string[]>;
  /** Never throws for a missing key — returns false instead. */
  exists(key: string): Promise<boolean>;
}
