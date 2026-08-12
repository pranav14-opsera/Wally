import { createStubMethod } from '../not-implemented.js';
import type {
  ICloudStorageService,
  StorageDownloadResult,
  StorageUploadOptions,
} from '../interfaces/index.js';

const PROVIDER = 'azure';
const BACKING_SERVICE = 'Azure Blob Storage';

/**
 * TODO(WO-021 follow-up): implement against Azure Blob Storage.
 * - SDK: @azure/storage-blob
 * - Config: AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_CONTAINER_NAME, AZURE_STORAGE_CONNECTION_STRING (or managed identity)
 * - upload/download map to BlockBlobClient#uploadData()/downloadToBuffer()
 * - list maps to ContainerClient#listBlobsFlat({ prefix })
 * - exists maps to BlockBlobClient#exists()
 */
export class AzureStorageStub implements ICloudStorageService {
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
