import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Logger } from 'pino';

import type {
  CloudErrorCode,
  ICloudStorageService,
  StorageDownloadResult,
  StorageUploadOptions,
} from '../interfaces/index.js';
import { StorageError } from '../interfaces/index.js';

const MAX_KEY_SEGMENT_LENGTH = 255;
const META_SUFFIX = '.meta.json';
// Windows can transiently hold a sharing lock on the destination of a
// rename() while another process/handle (e.g. antivirus, or a second
// concurrent rename to the same key) touches it, surfacing as EPERM/EACCES/
// EBUSY even though no real permission problem exists. These are retried
// with a short backoff; POSIX filesystems don't hit this path since rename()
// there is unconditionally atomic and never contends this way.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_MAX_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface StorageMetadataFile {
  metadata?: Record<string, string>;
  contentType?: string;
}

/**
 * Production-grade (not a mock) ICloudStorageService backed by the local
 * filesystem — selected when CLOUD_PROVIDER=local per the platform's
 * local-first principle. Behaves identically to S3StorageAdapter for
 * every method: same error semantics, same key namespacing.
 *
 * Each object is two files: `<key>` (the data) and `<key>.meta.json`
 * (its metadata/contentType). Writes go to a temp file per file, then
 * `fs.rename` both into place — rename is atomic on the same filesystem,
 * so a concurrent reader never observes a partially-written object.
 */
export class FilesystemStorageAdapter implements ICloudStorageService {
  public constructor(
    private readonly baseDir: string,
    private readonly logger: Logger,
  ) {
    // Synchronous and one-time at startup — constructors can't be async,
    // and every operation below assumes baseDir already exists.
    mkdirSync(this.baseDir, { recursive: true });
  }

  public async upload(key: string, data: Buffer, options?: StorageUploadOptions): Promise<void> {
    const filePath = this.sanitizeKey(key, { forWrite: true });
    const metaPath = `${filePath}${META_SUFFIX}`;
    const tempSuffix = randomUUID();
    const tempFilePath = `${filePath}.tmp-${tempSuffix}`;
    const tempMetaPath = `${metaPath}.tmp-${tempSuffix}`;

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const metaContent: StorageMetadataFile = {
        metadata: options?.metadata,
        contentType: options?.contentType,
      };
      await fs.writeFile(tempFilePath, data);
      await fs.writeFile(tempMetaPath, JSON.stringify(metaContent));

      await this.renameWithRetry(tempFilePath, filePath);
      await this.renameWithRetry(tempMetaPath, metaPath);

      this.logger.info({ key, bytes: data.length }, 'Uploaded storage object');
    } catch (error) {
      // Clean up any temp file left behind by a failed write/rename.
      await fs.rm(tempFilePath, { force: true });
      await fs.rm(tempMetaPath, { force: true });
      throw this.mapError(error, key, 'upload');
    }
  }

  public async download(key: string): Promise<StorageDownloadResult> {
    const filePath = this.sanitizeKey(key);

    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch (error) {
      throw this.mapError(error, key, 'download');
    }

    const metaPath = `${filePath}${META_SUFFIX}`;
    let metaContent: StorageMetadataFile = {};
    try {
      metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as StorageMetadataFile;
    } catch {
      // A missing or corrupt metadata companion is non-fatal — the data
      // file itself is authoritative; metadata is best-effort.
    }

    return { data, metadata: metaContent.metadata, contentType: metaContent.contentType };
  }

  public async delete(key: string): Promise<void> {
    const filePath = this.sanitizeKey(key);
    const metaPath = `${filePath}${META_SUFFIX}`;

    await this.removeIfExists(filePath, key);
    await this.removeIfExists(metaPath, key);
    await this.pruneEmptyDirectories(path.dirname(filePath));

    this.logger.info({ key }, 'Deleted storage object');
  }

  public async list(prefix?: string): Promise<string[]> {
    let keys: string[];
    try {
      keys = await this.walk(this.baseDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw this.mapError(error, prefix ?? '', 'list');
    }

    return prefix === undefined ? keys : keys.filter((key) => key.startsWith(prefix));
  }

  public async exists(key: string): Promise<boolean> {
    const filePath = this.sanitizeKey(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Rejects path traversal, absolute paths, and oversized segments; returns the resolved on-disk path. */
  private sanitizeKey(key: string, options: { forWrite?: boolean } = {}): string {
    const resolvedBase = path.resolve(this.baseDir);

    if (!key) {
      throw new StorageError('Storage key must not be empty', 'INVALID_ARGUMENT', 'local', 'sanitizeKey', key);
    }
    if (options.forWrite && key.endsWith('/')) {
      throw new StorageError(
        `Storage key must not end with '/' (looks like a directory prefix, not a file key): ${key}`,
        'INVALID_ARGUMENT',
        'local',
        'sanitizeKey',
        key,
      );
    }
    // path.isAbsolute() alone only recognizes the current platform's
    // absolute-path syntax; the drive-letter check keeps this correct
    // regardless of whether the process runs on Windows or Linux.
    if (path.isAbsolute(key) || /^[a-zA-Z]:/.test(key)) {
      throw new StorageError(`Storage key must be a relative path: ${key}`, 'INVALID_ARGUMENT', 'local', 'sanitizeKey', key);
    }

    for (const segment of key.split('/')) {
      if (segment === '..' || segment === '.') {
        throw new StorageError(
          `Storage key must not contain '.' or '..' segments: ${key}`,
          'INVALID_ARGUMENT',
          'local',
          'sanitizeKey',
          key,
        );
      }
      if (segment.length > MAX_KEY_SEGMENT_LENGTH) {
        throw new StorageError(
          `Storage key segment exceeds ${MAX_KEY_SEGMENT_LENGTH} characters: ${key}`,
          'INVALID_ARGUMENT',
          'local',
          'sanitizeKey',
          key,
        );
      }
    }

    const resolved = path.resolve(resolvedBase, key);
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
      throw new StorageError(
        `Storage key resolves outside the base directory: ${key}`,
        'INVALID_ARGUMENT',
        'local',
        'sanitizeKey',
        key,
      );
    }

    return resolved;
  }

  /**
   * Wraps fs.rename with a short retry-with-backoff on transient
   * EPERM/EACCES/EBUSY errors, which Windows can surface when two
   * concurrent uploads race to rename into the same destination key.
   */
  private async renameWithRetry(src: string, dest: string): Promise<void> {
    for (let attempt = 1; attempt <= RENAME_MAX_ATTEMPTS; attempt++) {
      try {
        await fs.rename(src, dest);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!code || !RENAME_RETRY_CODES.has(code) || attempt === RENAME_MAX_ATTEMPTS) {
          throw error;
        }
        await sleep(RENAME_RETRY_DELAY_MS * attempt);
      }
    }
  }

  private async removeIfExists(filePath: string, key: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw this.mapError(error, key, 'delete');
      }
    }
  }

  /** Removes now-empty directories walking up from `dir` toward (but never including) baseDir. */
  private async pruneEmptyDirectories(dir: string): Promise<void> {
    const resolvedBase = path.resolve(this.baseDir);
    let current = path.resolve(dir);

    while (current !== resolvedBase && current.startsWith(resolvedBase + path.sep)) {
      let entries: string[];
      try {
        entries = await fs.readdir(current);
      } catch {
        return;
      }
      if (entries.length > 0) {
        return;
      }
      await fs.rmdir(current);
      current = path.dirname(current);
    }
  }

  /** Recursively collects every stored data key under `dir`, excluding metadata companion files. */
  private async walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const keys: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        keys.push(...(await this.walk(fullPath)));
      } else if (entry.isFile() && !entry.name.endsWith(META_SUFFIX)) {
        keys.push(path.relative(this.baseDir, fullPath).split(path.sep).join('/'));
      }
    }

    return keys;
  }

  private mapError(error: unknown, key: string, operation: string): StorageError {
    const errno = error as NodeJS.ErrnoException;
    let code: CloudErrorCode;
    let message: string;

    if (errno.code === 'ENOENT') {
      code = 'NOT_FOUND';
      message = `Storage object not found: ${key}`;
    } else if (errno.code === 'EACCES' || errno.code === 'EPERM') {
      code = 'PERMISSION_DENIED';
      message = `Permission denied accessing storage object: ${key}`;
    } else if (errno.code === 'ENOSPC') {
      code = 'STORAGE_FULL';
      message = `Disk full while writing storage object: ${key}`;
    } else {
      code = 'PROVIDER_ERROR';
      message = `Storage operation '${operation}' failed for key: ${key}`;
    }

    this.logger.error({ key, operation, code }, message);
    return new StorageError(message, code, 'local', operation, key, undefined, error);
  }
}
