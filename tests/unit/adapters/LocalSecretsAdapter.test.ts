import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SecretsError } from '../../../src/adapters/cloud/index.js';
import { LocalSecretsAdapter } from '../../../src/adapters/cloud/local/LocalSecretsAdapter.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'secrets');
const MASTER_KEY_ENV_VAR = 'TEST_LOCAL_SECRETS_MASTER_KEY';
const silentLogger = pino({ level: 'silent' });

let secretsFilePath: string;
let originalEnv: string | undefined;

function newAdapter(lockTimeoutMs?: number): LocalSecretsAdapter {
  return new LocalSecretsAdapter(secretsFilePath, MASTER_KEY_ENV_VAR, silentLogger, lockTimeoutMs);
}

beforeEach(() => {
  secretsFilePath = join(tmpdir(), `wally-secrets-test-${randomUUID()}.enc`);
  originalEnv = process.env[MASTER_KEY_ENV_VAR];
  process.env[MASTER_KEY_ENV_VAR] = 'a'.repeat(32);
});

afterEach(async () => {
  await rm(secretsFilePath, { force: true });
  await rm(`${secretsFilePath}.lock`, { force: true });
  if (originalEnv === undefined) {
    delete process.env[MASTER_KEY_ENV_VAR];
  } else {
    process.env[MASTER_KEY_ENV_VAR] = originalEnv;
  }
});

describe('LocalSecretsAdapter', () => {
  it('throws MASTER_KEY_MISSING when the master key env var is not set, and never falls back to plaintext', () => {
    delete process.env[MASTER_KEY_ENV_VAR];

    let thrown: SecretsError | undefined;
    try {
      newAdapter();
      expect.unreachable('constructor should have thrown');
    } catch (error) {
      thrown = error as SecretsError;
    }

    expect(thrown).toBeInstanceOf(SecretsError);
    expect(thrown?.code).toBe('MASTER_KEY_MISSING');
    expect(thrown?.message).toContain(MASTER_KEY_ENV_VAR);
  });

  it('putSecret then getSecret round-trips the plaintext value', async () => {
    const adapter = newAdapter();
    const metadata = await adapter.putSecret('api-key', 'super-secret-value');

    expect(metadata.version).toBe('1');
    expect(metadata.createdAt).toBeInstanceOf(Date);
    expect(await adapter.getSecret('api-key')).toBe('super-secret-value');
  });

  it('persists secrets encrypted at rest — the raw file never contains the plaintext', async () => {
    const adapter = newAdapter();
    await adapter.putSecret('api-key', 'super-secret-value-xyz');

    const raw = await readFile(secretsFilePath, 'utf-8');
    expect(raw).not.toContain('super-secret-value-xyz');
  });

  it('getSecret throws SECRET_NOT_FOUND for a missing secret, without leaking any value', async () => {
    const adapter = newAdapter();

    let thrown: SecretsError | undefined;
    try {
      await adapter.getSecret('does-not-exist');
      expect.unreachable();
    } catch (error) {
      thrown = error as SecretsError;
    }

    expect(thrown).toBeInstanceOf(SecretsError);
    expect(thrown?.code).toBe('SECRET_NOT_FOUND');
    expect(thrown?.secretName).toBe('does-not-exist');
    expect(JSON.stringify(thrown?.toJSON())).not.toContain('does-not-exist-value');
  });

  it('rotateSecret creates a new version, preserving the previous one, and getSecret returns the latest', async () => {
    const adapter = newAdapter();
    await adapter.putSecret('db-password', 'v1-password');
    const rotated = await adapter.rotateSecret('db-password', 'v2-password');

    expect(rotated.version).toBe('2');
    expect(rotated.rotatedAt).toBeInstanceOf(Date);
    expect(await adapter.getSecret('db-password')).toBe('v2-password');

    const raw = JSON.parse(await readFile(secretsFilePath, 'utf-8')) as {
      secrets: Record<string, { versions: Array<{ version: number }> }>;
    };
    expect(raw.secrets['db-password']!.versions).toHaveLength(2);
  });

  it('rotateSecret trims history to a maximum of 3 versions', async () => {
    const adapter = newAdapter();
    await adapter.putSecret('rotating', 'v1');
    await adapter.rotateSecret('rotating', 'v2');
    await adapter.rotateSecret('rotating', 'v3');
    await adapter.rotateSecret('rotating', 'v4');

    const raw = JSON.parse(await readFile(secretsFilePath, 'utf-8')) as {
      secrets: Record<string, { versions: Array<{ version: number }> }>;
    };
    const versions = raw.secrets['rotating']!.versions;
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.version)).toEqual([2, 3, 4]);
    expect(await adapter.getSecret('rotating')).toBe('v4');
  });

  it('rotateSecret on a non-existent secret throws SECRET_NOT_FOUND and does not create it', async () => {
    const adapter = newAdapter();

    await expect(adapter.rotateSecret('never-created', 'value')).rejects.toMatchObject({
      code: 'SECRET_NOT_FOUND',
    });
    await expect(adapter.getSecret('never-created')).rejects.toMatchObject({ code: 'SECRET_NOT_FOUND' });
  });

  it('deleteSecret performs cryptographic erasure then removes the secret', async () => {
    const adapter = newAdapter();
    await adapter.putSecret('to-delete', 'sensitive-value');
    await adapter.deleteSecret('to-delete');

    await expect(adapter.getSecret('to-delete')).rejects.toMatchObject({ code: 'SECRET_NOT_FOUND' });
    const raw = await readFile(secretsFilePath, 'utf-8');
    expect(raw).not.toContain('sensitive-value');
    expect(JSON.parse(raw).secrets['to-delete']).toBeUndefined();
  });

  it('deleteSecret on a non-existent secret is a no-op (idempotent), matching the interface contract', async () => {
    const adapter = newAdapter();
    await expect(adapter.deleteSecret('never-existed')).resolves.toBeUndefined();
  });

  it('creates the encrypted file automatically on first write if it does not exist', async () => {
    const adapter = newAdapter();
    await expect(readFile(secretsFilePath)).rejects.toThrow();

    await adapter.putSecret('first', 'value');
    await expect(readFile(secretsFilePath)).resolves.toBeDefined();
  });

  it('detects a corrupted/tampered file and throws CORRUPTION_DETECTED rather than returning garbage', async () => {
    const adapter = newAdapter();
    await adapter.putSecret('secret-a', 'value-a');

    const raw = JSON.parse(await readFile(secretsFilePath, 'utf-8'));
    raw.secrets['secret-a'].versions[0].payload.authTag = Buffer.from('tampered-tag-16b').toString('base64');
    await writeFile(secretsFilePath, JSON.stringify(raw), 'utf-8');

    await expect(adapter.getSecret('secret-a')).rejects.toMatchObject({ code: 'CORRUPTION_DETECTED' });
  });

  it('detects invalid JSON in the secrets file and throws CORRUPTION_DETECTED', async () => {
    await mkdir(join(secretsFilePath, '..'), { recursive: true });
    await writeFile(secretsFilePath, 'not valid json {{{', 'utf-8');

    const adapter = newAdapter();
    await expect(adapter.getSecret('anything')).rejects.toMatchObject({ code: 'CORRUPTION_DETECTED' });
  });

  it('a master key that changes between restarts makes existing secrets undecryptable, raised as CORRUPTION_DETECTED', async () => {
    const adapter = newAdapter();
    await adapter.putSecret('secret-b', 'value-b');

    process.env[MASTER_KEY_ENV_VAR] = 'b'.repeat(32);
    const secondAdapter = newAdapter();

    await expect(secondAdapter.getSecret('secret-b')).rejects.toMatchObject({ code: 'CORRUPTION_DETECTED' });
  });

  it('handles secret names with slashes, dots, and unicode consistently', async () => {
    const adapter = newAdapter();
    const names = ['path/to/secret', 'secret.with.dots', 'ünïcödé-secret-🔒'];

    for (const name of names) {
      await adapter.putSecret(name, `value-for-${name}`);
    }
    for (const name of names) {
      expect(await adapter.getSecret(name)).toBe(`value-for-${name}`);
    }
  });

  it('handles very large secret values (>1MB) without error', async () => {
    const adapter = newAdapter();
    const large = 'x'.repeat(2 * 1024 * 1024);

    await adapter.putSecret('large-secret', large);
    expect(await adapter.getSecret('large-secret')).toBe(large);
  });

  it('serializes concurrent putSecret calls via file locking without losing data', async () => {
    const adapter = newAdapter();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => adapter.putSecret(`concurrent-${i}`, `value-${i}`)),
    );

    for (let i = 0; i < 10; i++) {
      expect(await adapter.getSecret(`concurrent-${i}`)).toBe(`value-${i}`);
    }
  });

  it('a second writer times out with LOCK_TIMEOUT if the lock is held past the configured timeout', async () => {
    const adapter = newAdapter(100);
    const lockPath = `${secretsFilePath}.lock`;
    await mkdir(join(secretsFilePath, '..'), { recursive: true });
    await writeFile(lockPath, '', { flag: 'wx' });

    try {
      await expect(adapter.putSecret('blocked', 'value')).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
    } finally {
      await rm(lockPath, { force: true });
    }
  });

  describe('init()', () => {
    it('auto-generates a JWT RS256 key pair on first boot when none exists', async () => {
      const adapter = newAdapter();
      await adapter.init();

      const privateKey = await adapter.getSecret('jwt-signing-key-private');
      const publicKey = await adapter.getSecret('jwt-signing-key-public');
      expect(privateKey).toContain('BEGIN PRIVATE KEY');
      expect(publicKey).toContain('BEGIN PUBLIC KEY');
    });

    it('does not regenerate the key pair if one already exists', async () => {
      const adapter = newAdapter();
      await adapter.init();
      const firstPrivateKey = await adapter.getSecret('jwt-signing-key-private');

      await adapter.init();
      const secondPrivateKey = await adapter.getSecret('jwt-signing-key-private');

      expect(secondPrivateKey).toBe(firstPrivateKey);
    });
  });

  describe('fixture-based deterministic decryption', () => {
    it('decrypts the committed pre-encrypted fixture using the committed test master key', async () => {
      const fixtureMasterKey = (await readFile(join(FIXTURES_DIR, 'test-master.key'), 'utf-8')).trim();
      await copyFile(join(FIXTURES_DIR, 'test-secrets.enc'), secretsFilePath);

      process.env[MASTER_KEY_ENV_VAR] = fixtureMasterKey;
      const adapter = newAdapter();

      expect(await adapter.getSecret('fixture/test-secret')).toBe('fixture-plaintext-value');
    });
  });
});
