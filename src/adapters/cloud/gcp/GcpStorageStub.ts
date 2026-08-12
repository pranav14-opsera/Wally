import { createStubMethod } from '../not-implemented.js';
import type {
  ICloudStorageService,
  StorageDownloadResult,
  StorageUploadOptions,
} from '../interfaces/index.js';

const PROVIDER = 'gcp';
const BACKING_SERVICE = 'Google Cloud Storage';

/**
 * TODO(WO-021 follow-up): implement against Google Cloud Storage.
 * - SDK: @google-cloud/storage
 * - Config: GCS_BUCKET_NAME, GOOGLE_APPLICATION_CREDENTIALS (or workload identity)
 * - upload/download map to Bucket#file(key).save()/download()
 * - list maps to Bucket#getFiles({ prefix })
 * - exists maps to File#exists()
 */
export class GcpStorageStub implements ICloudStorageService {
  public upload: (key: string, data: Buffer, options?: StorageUploadOptions) => Promise<void> = createStubMethod(
    PROVIDER,
    'upload',
    BACKING_SERVICE,
  );

  public download: (key: string) => Promise<StorageDownloadResult> = createStubMethod(
    PROVIDER,
    'download',
    BACKING_SERVICE,
  );

  public delete: (key: string) => Promise<void> = createStubMethod(PROVIDER, 'delete', BACKING_SERVICE);

  public list: (prefix?: string) => Promise<string[]> = createStubMethod(PROVIDER, 'list', BACKING_SERVICE);

  public exists: (key: string) => Promise<boolean> = createStubMethod(PROVIDER, 'exists', BACKING_SERVICE);
}
