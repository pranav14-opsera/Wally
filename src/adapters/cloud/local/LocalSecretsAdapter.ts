import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scryptSync,
} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Logger } from 'pino';

import type { ICloudSecretsService, SecretMetadata } from '../interfaces/index.js';
import { SecretsError } from '../interfaces/index.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const MAX_VERSIONS = 3;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_SUFFIX = '.lock';

const JWT_PRIVATE_KEY_SECRET_NAME = 'jwt-signing-key-private';
const JWT_PUBLIC_KEY_SECRET_NAME = 'jwt-signing-key-public';

// Same rationale as FilesystemStorageAdapter's RENAME_RETRY_CODES: Windows
// can transiently hold a sharing lock on a rename() destination.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_MAX_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface EncryptedPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface SecretVersionEntry {
  version: number;
  payload: EncryptedPayload;
  createdAt: string;
}

interface SecretFileEntry {
  versions: SecretVersionEntry[];
  createdAt: string;
  updatedAt: string;
}

interface SecretsFileShape {
  /** base64 — derives the AES-256 key from the master key via scrypt. Generated once, persisted forever. */
  salt: string;
  secrets: Record<string, SecretFileEntry>;
}

/**
 * Production-grade (not a mock) ICloudSecretsService backed by an
 * AES-256-GCM-encrypted JSON file on disk — selected when
 * CLOUD_PROVIDER=local. The master key never touches disk: it's read
 * once from `masterKeyEnvVar` and used (via scrypt, keyed by a
 * persisted salt) to derive the AES key in memory only.
 *
 * Reads are lock-free (the file is always fully valid — see
 * `persistFile`'s atomic rename); writes (put/rotate/delete) take a
 * `.lock` file for their whole read-modify-write cycle so concurrent
 * writers never race on the same base file.
 */
export class LocalSecretsAdapter implements ICloudSecretsService {
  private readonly masterKey: string;
  private derivedKey: { salt: string; key: Buffer } | undefined;

  public constructor(
    private readonly filePath: string,
    masterKeyEnvVar: string,
    private readonly logger: Logger,
    private readonly lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
  ) {
    const masterKey = process.env[masterKeyEnvVar];
    if (!masterKey) {
      throw new SecretsError(
        `${masterKeyEnvVar} is not set. Set it to a strong random value (32+ characters) before ` +
          `starting the app with CLOUD_PROVIDER=local — see .env.example. Refusing to fall back to ` +
          'plaintext secret storage.',
        'MASTER_KEY_MISSING',
        'local',
        'constructor',
        '',
      );
    }
    this.masterKey = masterKey;
  }

  /** Auto-generates the JWT RS256 signing key pair on first boot if it doesn't already exist. */
  public async init(): Promise<void> {
    const hasKeys = await this.hasSecret(JWT_PRIVATE_KEY_SECRET_NAME);
    if (hasKeys) {
      return;
    }

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    await this.putSecret(JWT_PRIVATE_KEY_SECRET_NAME, privateKey);
    await this.putSecret(JWT_PUBLIC_KEY_SECRET_NAME, publicKey);
    this.logger.info({ operation: 'init' }, 'Generated JWT RS256 signing key pair on first boot');
  }

  public async getSecret(name: string): Promise<string> {
    const file = await this.loadFile();
    const entry = file?.secrets[name];
    if (!entry || entry.versions.length === 0) {
      throw new SecretsError(`Secret not found: ${name}`, 'SECRET_NOT_FOUND', 'local', 'getSecret', name);
    }

    const key = this.getKey(file!.salt);
    const latest = entry.versions[entry.versions.length - 1]!;
    return this.decrypt(latest.payload, key, name, 'getSecret');
  }

  public async putSecret(name: string, value: string): Promise<SecretMetadata> {
    return this.withLock(async () => {
      const file = await this.loadOrInitFile();
      const key = this.getKey(file.salt);
      const now = new Date();

      const entry: SecretFileEntry = {
        versions: [{ version: 1, payload: this.encrypt(value, key), createdAt: now.toISOString() }],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      file.secrets[name] = entry;

      await this.persistFile(file);
      this.logger.info({ secretName: name, operation: 'putSecret', version: 1 }, 'Secret stored');
      return { version: '1', createdAt: now };
    });
  }

  public async rotateSecret(name: string, newValue: string): Promise<SecretMetadata> {
    return this.withLock(async () => {
      const file = await this.loadOrInitFile();
      const existing = file.secrets[name];
      if (!existing || existing.versions.length === 0) {
        throw new SecretsError(`Secret not found: ${name}`, 'SECRET_NOT_FOUND', 'local', 'rotateSecret', name);
      }

      const key = this.getKey(file.salt);
      const now = new Date();
      const nextVersion = existing.versions[existing.versions.length - 1]!.version + 1;

      const versions = [
        ...existing.versions,
        { version: nextVersion, payload: this.encrypt(newValue, key), createdAt: now.toISOString() },
      ].slice(-MAX_VERSIONS);

      file.secrets[name] = { ...existing, versions, updatedAt: now.toISOString() };
      await this.persistFile(file);

      this.logger.info({ secretName: name, operation: 'rotateSecret', version: nextVersion }, 'Secret rotated');
      return { version: String(nextVersion), createdAt: new Date(existing.createdAt), rotatedAt: now };
    });
  }

  public async deleteSecret(name: string): Promise<void> {
    await this.withLock(async () => {
      const file = await this.loadOrInitFile();
      const entry = file.secrets[name];
      if (!entry) {
        // Idempotent, matching StubSecretsAdapter/ICloudSecretsService's
        // implicit "delete of something already gone is a no-op" contract.
        return;
      }

      // Cryptographic erasure: shred each version's ciphertext bytes with
      // random data and persist that overwritten state *before* removing
      // the entry outright, so no filesystem journal/snapshot copy
      // retains the original ciphertext.
      for (const version of entry.versions) {
        const ciphertextLength = Buffer.from(version.payload.ciphertext, 'base64').length;
        version.payload = {
          iv: randomBytes(IV_LENGTH).toString('base64'),
          authTag: randomBytes(16).toString('base64'),
          ciphertext: randomBytes(ciphertextLength).toString('base64'),
        };
      }
      await this.persistFile(file);

      delete file.secrets[name];
      await this.persistFile(file);

      this.logger.info({ secretName: name, operation: 'deleteSecret' }, 'Secret deleted (cryptographic erasure)');
    });
  }

  private async hasSecret(name: string): Promise<boolean> {
    try {
      await this.getSecret(name);
      return true;
    } catch (error) {
      if (error instanceof SecretsError && error.code === 'SECRET_NOT_FOUND') {
        return false;
      }
      throw error;
    }
  }

  private getKey(saltB64: string): Buffer {
    if (this.derivedKey && this.derivedKey.salt === saltB64) {
      return this.derivedKey.key;
    }
    // scrypt is deliberately slow/memory-hard — this is a KDF step, not a
    // hot path (called once per file's salt, then cached for the
    // adapter's lifetime).
    const key = scryptSync(this.masterKey, Buffer.from(saltB64, 'base64'), KEY_LENGTH);
    this.derivedKey = { salt: saltB64, key };
    return key;
  }

  private encrypt(plaintext: string, key: Buffer): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt(payload: EncryptedPayload, key: Buffer, secretName: string, operation: string): string {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch (error) {
      // Covers both a tampered/corrupted file and a wrong master key
      // (e.g. changed between restarts) — GCM auth-tag verification
      // fails identically either way, and the WO's error taxonomy
      // deliberately doesn't distinguish the two: never reveal which.
      throw new SecretsError(
        `Secret "${secretName}" could not be decrypted — the secrets file may be corrupted, or ` +
          'LOCAL_SECRETS_MASTER_KEY may not match the key it was encrypted with.',
        'CORRUPTION_DETECTED',
        'local',
        operation,
        secretName,
        error,
      );
    }
  }

  /** Read-only — returns null if the file doesn't exist yet. Never creates it (that only happens inside a write's lock). */
  private async loadFile(): Promise<SecretsFileShape | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    return this.parseFile(raw);
  }

  private parseFile(raw: string): SecretsFileShape {
    try {
      const parsed = JSON.parse(raw) as Partial<SecretsFileShape>;
      if (typeof parsed.salt !== 'string' || typeof parsed.secrets !== 'object' || parsed.secrets === null) {
        throw new Error('secrets file is missing required "salt"/"secrets" fields');
      }
      return parsed as SecretsFileShape;
    } catch (error) {
      throw new SecretsError(
        'Secrets file is corrupted or unreadable (invalid JSON/shape).',
        'CORRUPTION_DETECTED',
        'local',
        'loadFile',
        '',
        error,
      );
    }
  }

  /** Only called from within `withLock` — creates a fresh file (with a new salt) if none exists yet. */
  private async loadOrInitFile(): Promise<SecretsFileShape> {
    const existing = await this.loadFile();
    if (existing) {
      return existing;
    }
    const fresh: SecretsFileShape = { salt: randomBytes(SALT_LENGTH).toString('base64'), secrets: {} };
    await this.persistFile(fresh);
    return fresh;
  }

  private async persistFile(file: SecretsFileShape): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${randomUUID()}`;
    await fs.writeFile(tempPath, JSON.stringify(file), { mode: 0o600 });
    try {
      await this.renameWithRetry(tempPath, this.filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

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

  /** Serializes the whole read-modify-write cycle of a write operation across concurrent callers (same process or otherwise) via a `.lock` file. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireLock();
    try {
      return await fn();
    } finally {
      await this.releaseLock();
    }
  }

  private async acquireLock(): Promise<void> {
    const lockPath = `${this.filePath}${LOCK_SUFFIX}`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;

    for (;;) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.close();
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        if (Date.now() >= deadline) {
          throw new SecretsError(
            `Timed out after ${this.lockTimeoutMs}ms waiting for the secrets file lock — another operation ` +
              'may be stuck holding it.',
            'LOCK_TIMEOUT',
            'local',
            'acquireLock',
            '',
          );
        }
        await sleep(LOCK_RETRY_DELAY_MS);
      }
    }
  }

  private async releaseLock(): Promise<void> {
    await fs.rm(`${this.filePath}${LOCK_SUFFIX}`, { force: true });
  }
}
