import { generateKeyPairSync } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { JwtService } from '../../../../src/gateway/auth/jwt.service.js';
import { AppError } from '../../../../src/gateway/utils/errors.js';

const KEY_PAIR = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const WRONG_KEY_PAIR = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function fakeSecrets(overrides: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    'jwt-signing-key-private': KEY_PAIR.privateKey,
    'jwt-signing-key-public': KEY_PAIR.publicKey,
    ...overrides,
  };
  return {
    getSecret: async (name: string) => {
      const value = values[name];
      if (value === undefined) {
        throw new Error(`no secret named "${name}"`);
      }
      return value;
    },
    putSecret: async () => ({ version: '1', createdAt: new Date() }),
    rotateSecret: async () => ({ version: '2', createdAt: new Date() }),
    deleteSecret: async () => {},
  };
}

async function newService() {
  const service = new JwtService(fakeSecrets());
  await service.init();
  return service;
}

describe('JwtService', () => {
  it('throws when init() fails to load the key pair from the secrets store', async () => {
    const service = new JwtService(fakeSecrets({ 'jwt-signing-key-private': undefined }));
    await expect(service.init()).rejects.toThrow(/failed to load the RS256 signing key pair/);
  });

  it('throws when signing before init() has been awaited', () => {
    const service = new JwtService(fakeSecrets());
    expect(() => service.generateAccessToken('u1', 'a@test.com', 'admin')).toThrow(/init\(\) must be awaited/);
  });

  it('generates an access token that verifies with the expected claims', async () => {
    const service = await newService();

    const token = service.generateAccessToken('user-1', 'a@test.com', 'admin');
    const payload = service.verifyToken(token, 'access');

    expect(payload).toMatchObject({ sub: 'user-1', email: 'a@test.com', role: 'admin', type: 'access' });
    expect(payload.jti).toEqual(expect.any(String));
  });

  it('generates a refresh token that verifies with type=refresh', async () => {
    const service = await newService();

    const token = service.generateRefreshToken('user-1', 'a@test.com', 'viewer');
    const payload = service.verifyToken(token, 'refresh');

    expect(payload.type).toBe('refresh');
  });

  it('rejects a refresh token presented where an access token is required (edge case)', async () => {
    const service = await newService();
    const refreshToken = service.generateRefreshToken('user-1', 'a@test.com', 'viewer');

    expect(() => service.verifyToken(refreshToken, 'access')).toThrow(AppError);
    try {
      service.verifyToken(refreshToken, 'access');
    } catch (error) {
      expect((error as AppError).code).toBe('AUTHENTICATION_ERROR');
    }
  });

  it('rejects an expired token with TOKEN_EXPIRED', async () => {
    const service = await newService();
    const expiredToken = jwt.sign({ sub: 'u1', email: 'a@test.com', role: 'admin', type: 'access' }, KEY_PAIR.privateKey, {
      algorithm: 'RS256',
      expiresIn: -60,
      issuer: 'wally-gateway',
      jwtid: 'jti-1',
    });

    expect(() => service.verifyToken(expiredToken, 'access')).toThrow(AppError);
    try {
      service.verifyToken(expiredToken, 'access');
    } catch (error) {
      expect((error as AppError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('rejects a malformed token (not three dot-separated segments) with 401, not a crash (edge case)', async () => {
    const service = await newService();

    expect(() => service.verifyToken('not-a-jwt', 'access')).toThrow(AppError);
    try {
      service.verifyToken('not-a-jwt', 'access');
    } catch (error) {
      expect((error as AppError).statusCode).toBe(401);
    }
  });

  it('rejects a token signed with the wrong key (tampered/forged) (edge case)', async () => {
    const service = await newService();
    const forged = jwt.sign({ sub: 'u1', email: 'a@test.com', role: 'admin', type: 'access' }, WRONG_KEY_PAIR.privateKey, {
      algorithm: 'RS256',
      expiresIn: 900,
      issuer: 'wally-gateway',
      jwtid: 'jti-2',
    });

    expect(() => service.verifyToken(forged, 'access')).toThrow(AppError);
  });

  it('rejects a token signed with HS256 instead of RS256 (algorithm confusion, edge case)', async () => {
    const service = await newService();
    const hsToken = jwt.sign({ sub: 'u1', email: 'a@test.com', role: 'admin', type: 'access' }, KEY_PAIR.publicKey, {
      algorithm: 'HS256',
      expiresIn: 900,
      issuer: 'wally-gateway',
    });

    expect(() => service.verifyToken(hsToken, 'access')).toThrow(AppError);
  });

  it('rejects a token missing required claims', async () => {
    const service = await newService();
    const incomplete = jwt.sign({ sub: 'u1' }, KEY_PAIR.privateKey, {
      algorithm: 'RS256',
      expiresIn: 900,
      issuer: 'wally-gateway',
      jwtid: 'jti-3',
    });

    expect(() => service.verifyToken(incomplete, 'access')).toThrow(AppError);
  });
});
