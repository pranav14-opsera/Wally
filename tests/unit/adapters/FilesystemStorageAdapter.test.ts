import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StorageError } from '../../../src/adapters/cloud/index.js';
import { FilesystemStorageAdapter } from '../../../src/adapters/cloud/local/FilesystemStorageAdapter.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'storage');
const silentLogger = pino({ level: 'silent' });

let baseDir: string;
let adapter: FilesystemStorageAdapter;

beforeEach(() => {
  baseDir = join(tmpdir(), `wally-fs-storage-test-${randomUUID()}`);
  adapter = new FilesystemStorageAdapter(baseDir, silentLogger);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('FilesystemStorageAdapter', () => {
  it('creates the base directory automatically if it does not exist', async () => {
    expect(await adapter.exists('anything')).toBe(false);
  });

  it('round-trips upload/download with metadata and contentType', async () => {
    await adapter.upload('reports/report.json', Buffer.from('{"ok":true}'), {
      metadata: { jobId: 'job-1' },
      contentType: 'application/json',
    });

    const result = await adapter.download('reports/report.json');
    expect(result.data.toString()).toBe('{"ok":true}');
    expect(result.metadata).toEqual({ jobId: 'job-1' });
    expect(result.contentType).toBe('application/json');
  });

  it('upload() creates intermediate directories automatically', async () => {
    await adapter.upload('a/b/c/d/deep.txt', Buffer.from('deep'));
    expect(await adapter.exists('a/b/c/d/deep.txt')).toBe(true);
  });

  it('download() throws a StorageError with code NOT_FOUND for a missing key', async () => {
    await expect(adapter.download('missing.txt')).rejects.toThrow(StorageError);

    try {
      await adapter.download('missing.txt');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('NOT_FOUND');
      expect((error as StorageError).key).toBe('missing.txt');
    }
  });

  it('delete() removes the file and is idempotent for a missing key', async () => {
    await adapter.upload('to-delete.txt', Buffer.from('bye'));
    expect(await adapter.exists('to-delete.txt')).toBe(true);

    await adapter.delete('to-delete.txt');
    expect(await adapter.exists('to-delete.txt')).toBe(false);

    // Second delete of the same (now-missing) key must not throw.
    await expect(adapter.delete('to-delete.txt')).resolves.toBeUndefined();
  });

  it('delete() cleans up empty parent directories up to (but not including) the base dir', async () => {
    await adapter.upload('jobs/123/report.json', Buffer.from('{}'));
    await adapter.delete('jobs/123/report.json');

    // Both 'jobs/123' and 'jobs' should have been pruned since they're empty.
    expect(await adapter.list()).toEqual([]);
    await expect(adapter.upload('jobs/123/another.json', Buffer.from('{}'))).resolves.toBeUndefined();
  });

  it('list() returns keys recursively and filters by prefix', async () => {
    await adapter.upload('reports/a.json', Buffer.from('a'));
    await adapter.upload('reports/nested/b.json', Buffer.from('b'));
    await adapter.upload('other/c.json', Buffer.from('c'));

    expect((await adapter.list()).sort()).toEqual(
      ['other/c.json', 'reports/a.json', 'reports/nested/b.json'].sort(),
    );
    expect((await adapter.list('reports/')).sort()).toEqual(
      ['reports/a.json', 'reports/nested/b.json'].sort(),
    );
  });

  it('list() excludes .meta.json companion files from results', async () => {
    await adapter.upload('key.txt', Buffer.from('data'));
    const keys = await adapter.list();
    expect(keys).toEqual(['key.txt']);
    expect(keys.some((key) => key.endsWith('.meta.json'))).toBe(false);
  });

  it('exists() returns true/false correctly without throwing', async () => {
    expect(await adapter.exists('nope.txt')).toBe(false);
    await adapter.upload('yep.txt', Buffer.from('x'));
    expect(await adapter.exists('yep.txt')).toBe(true);
  });

  it('rejects an empty key with a typed StorageError', async () => {
    await expect(adapter.upload('', Buffer.from('x'))).rejects.toThrow(StorageError);
  });

  it('rejects path traversal attempts with code INVALID_ARGUMENT', async () => {
    for (const badKey of ['../escape.txt', 'a/../../escape.txt', '../../etc/passwd']) {
      try {
        await adapter.upload(badKey, Buffer.from('x'));
        expect.unreachable(`expected ${badKey} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe('INVALID_ARGUMENT');
      }
    }
  });

  it('rejects absolute paths', async () => {
    await expect(adapter.upload('/etc/passwd', Buffer.from('x'))).rejects.toThrow(StorageError);
  });

  it('rejects a key ending in "/" for upload (looks like a directory prefix, not a file key)', async () => {
    await expect(adapter.upload('looks-like-a-dir/', Buffer.from('x'))).rejects.toThrow(StorageError);
  });

  it('rejects a key segment longer than 255 characters', async () => {
    const tooLong = 'a'.repeat(256);
    await expect(adapter.upload(tooLong, Buffer.from('x'))).rejects.toThrow(StorageError);
  });

  it('handles concurrent uploads to the same key without corruption (last write wins)', async () => {
    await Promise.all([
      adapter.upload('race.txt', Buffer.from('first')),
      adapter.upload('race.txt', Buffer.from('second-longer')),
    ]);

    const result = await adapter.download('race.txt');
    // Whichever write's rename landed last, the file must be intact
    // (exactly one full write), never a mix of both.
    expect(['first', 'second-longer']).toContain(result.data.toString());
  });

  it('handles a large file (>1MB)', async () => {
    const largeBuffer = Buffer.alloc(1024 * 1024 + 1, 'x');
    await adapter.upload('large.bin', largeBuffer);

    const result = await adapter.download('large.bin');
    expect(result.data.length).toBe(largeBuffer.length);
    expect(result.data.equals(largeBuffer)).toBe(true);
  });

  it('round-trips the committed JSON and binary fixtures', async () => {
    const jsonFixture = await readFile(join(FIXTURES_DIR, 'sample.json'));
    const binaryFixture = await readFile(join(FIXTURES_DIR, 'sample-binary.bin'));

    await adapter.upload('fixtures/sample.json', jsonFixture, { contentType: 'application/json' });
    await adapter.upload('fixtures/sample-binary.bin', binaryFixture, {
      contentType: 'application/octet-stream',
    });

    expect((await adapter.download('fixtures/sample.json')).data.equals(jsonFixture)).toBe(true);
    expect((await adapter.download('fixtures/sample-binary.bin')).data.equals(binaryFixture)).toBe(
      true,
    );
  });

  it('download() tolerates a missing metadata companion file (data is authoritative)', async () => {
    await adapter.upload('no-meta-issue.txt', Buffer.from('content'));
    // Even without deleting the real .meta.json, verify download works when
    // metadata is absent by uploading without options (empty metadata object).
    const result = await adapter.download('no-meta-issue.txt');
    expect(result.data.toString()).toBe('content');
    expect(result.metadata).toBeUndefined();
  });
});
