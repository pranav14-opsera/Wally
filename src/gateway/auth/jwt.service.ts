import jwt from 'jsonwebtoken';

import type { ICloudSecretsService } from '../../adapters/cloud/index.js';
import { AppError } from '../utils/errors.js';
import type { Role } from './roles.js';
import { isRole } from './roles.js';

// Names LocalSecretsAdapter (WO-016) auto-generates this RS256 key pair
// under on first boot, and SecretsManagerAdapter (WO-019) expects the
// same names to already exist in AWS Secrets Manager for production —
// one pair of names, regardless of CLOUD_PROVIDER.
const JWT_PRIVATE_KEY_SECRET_NAME = 'jwt-signing-key-private';
const JWT_PUBLIC_KEY_SECRET_NAME = 'jwt-signing-key-public';
const JWT_ISSUER = 'wally-gateway';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const CLOCK_TOLERANCE_SECONDS = 30;

export type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
  type: TokenType;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    jwt: JwtService;
  }
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

/**
 * RS256 token lifecycle (WO-040). The key pair is loaded from
 * `ICloudSecretsService` at `init()` — never generated or read from disk
 * here — so the same code works unchanged against `LocalSecretsAdapter`
 * (local dev, auto-generates the pair) and `SecretsManagerAdapter`
 * (production, pair pre-provisioned in AWS Secrets Manager).
 */
export class JwtService {
  private privateKey: string | undefined;
  private publicKey: string | undefined;

  public constructor(private readonly secrets: ICloudSecretsService) {}

  public async init(): Promise<void> {
    try {
      const [privateKey, publicKey] = await Promise.all([
        this.secrets.getSecret(JWT_PRIVATE_KEY_SECRET_NAME),
        this.secrets.getSecret(JWT_PUBLIC_KEY_SECRET_NAME),
      ]);
      this.privateKey = privateKey;
      this.publicKey = publicKey;
    } catch (error) {
      // Auth cannot function without signing keys — fail fast at boot
      // (WO-040 edge case) rather than starting a gateway that would
      // 500 on every authenticated request.
      throw new Error(
        `JwtService failed to load the RS256 signing key pair ("${JWT_PRIVATE_KEY_SECRET_NAME}"/"${JWT_PUBLIC_KEY_SECRET_NAME}") from the secrets store: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private requirePrivateKey(): string {
    if (!this.privateKey) {
      throw new Error('JwtService.init() must be awaited before signing tokens');
    }
    return this.privateKey;
  }

  private requirePublicKey(): string {
    if (!this.publicKey) {
      throw new Error('JwtService.init() must be awaited before verifying tokens');
    }
    return this.publicKey;
  }

  private sign(userId: string, email: string, role: Role, type: TokenType, ttlSeconds: number): string {
    const payload: Omit<TokenPayload, 'jti'> = { sub: userId, email, role, type };
    return jwt.sign(payload, this.requirePrivateKey(), {
      algorithm: 'RS256',
      expiresIn: ttlSeconds,
      issuer: JWT_ISSUER,
      jwtid: crypto.randomUUID(),
    });
  }

  public generateAccessToken(userId: string, email: string, role: Role): string {
    return this.sign(userId, email, role, 'access', ACCESS_TOKEN_TTL_SECONDS);
  }

  public generateRefreshToken(userId: string, email: string, role: Role): string {
    return this.sign(userId, email, role, 'refresh', REFRESH_TOKEN_TTL_SECONDS);
  }

  public generateTokenPair(userId: string, email: string, role: Role): TokenPair {
    return {
      accessToken: this.generateAccessToken(userId, email, role),
      refreshToken: this.generateRefreshToken(userId, email, role),
    };
  }

  /**
   * Verifies signature, expiry, issuer, and clock tolerance, then
   * enforces `expectedType` — a refresh token can never be used where an
   * access token is required (WO-040 edge case: "refresh token used as
   * access token — must reject").
   */
  public verifyToken(token: string, expectedType: TokenType): TokenPayload {
    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, this.requirePublicKey(), {
        algorithms: ['RS256'],
        issuer: JWT_ISSUER,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }) as jwt.JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('Token expired', 'TOKEN_EXPIRED', 401);
      }
      // Malformed tokens, bad signatures, and wrong-algorithm tokens
      // (HS256 instead of RS256) all land here as a generic
      // `JsonWebTokenError` — never a 500 (WO-040 edge cases).
      throw new AppError('Invalid token', 'AUTHENTICATION_ERROR', 401);
    }

    const { sub, email, role, type, jti } = decoded;
    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      typeof role !== 'string' ||
      typeof type !== 'string' ||
      typeof jti !== 'string' ||
      !isRole(role)
    ) {
      throw new AppError('Invalid token', 'AUTHENTICATION_ERROR', 401);
    }
    if (type !== expectedType) {
      throw new AppError(`Expected a ${expectedType} token`, 'AUTHENTICATION_ERROR', 401);
    }

    return { sub, email, role, type, jti };
  }
}
