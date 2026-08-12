import bcrypt from 'bcryptjs';
import type { Logger } from 'pino';

import { AppError } from '../utils/errors.js';
import type { JwtService, TokenPair } from './jwt.service.js';
import { isRole, type Role } from './roles.js';
import { findUserByEmail, type IUserRepository } from './user.repository.js';

// A password hash for a password nobody knows (a fresh random UUID,
// hashed once at module load) — `login()` always runs `bcrypt.compare`
// against SOME hash, even when the email doesn't match any user, so
// response timing for "no such user" is indistinguishable from "wrong
// password" (WO-042 edge case: timing-attack mitigation).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomUUID(), 10);

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  user: AuthenticatedUser;
  tokens: TokenPair;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
}

/**
 * Login/refresh/logout (WO-042). No Redis-backed refresh-token blacklist
 * (technical_details' suggested approach) — this codebase has no Redis
 * client wired up yet (WO-030's BullMQ/Redis setup is a separate,
 * currently-unimplemented epic), so refresh tokens rotate but old ones
 * aren't server-side-revoked before their natural 7-day expiry. Real but
 * reduced-security trade-off, not a fake stub — logged here so it isn't
 * silently forgotten.
 */
export class AuthService {
  public constructor(
    private readonly users: IUserRepository,
    private readonly jwtService: JwtService,
    private readonly logger: Logger,
  ) {}

  public async login(username: string, password: string, context: RequestContext): Promise<AuthResult> {
    const user = await findUserByEmail(this.users, username);
    const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

    if (!user || !passwordMatches || !isRole(user.role)) {
      this.logger.warn(
        { event: 'login', username, ip: context.ip, userAgent: context.userAgent, success: false },
        'Login failed',
      );
      throw new AppError('Invalid credentials', 'AUTHENTICATION_ERROR', 401);
    }

    if (user.is_locked) {
      this.logger.warn(
        { event: 'login', actorId: user.id, username, ip: context.ip, userAgent: context.userAgent, success: false, reason: 'locked' },
        'Login rejected — account locked',
      );
      throw new AppError('Account is temporarily locked', 'AUTHORIZATION_ERROR', 423);
    }

    const tokens = this.jwtService.generateTokenPair(user.id, user.email, user.role);
    this.logger.info(
      { event: 'login', actorId: user.id, username, ip: context.ip, userAgent: context.userAgent, success: true },
      'Login succeeded',
    );

    return { user: { id: user.id, email: user.email, role: user.role }, tokens };
  }

  public async refresh(refreshToken: string, context: RequestContext): Promise<AuthResult> {
    const payload = this.jwtService.verifyToken(refreshToken, 'refresh');
    const user = await this.users.findById(payload.sub);

    if (!user || !isRole(user.role)) {
      throw new AppError('Refresh token expired or invalid', 'TOKEN_EXPIRED', 401);
    }

    // Re-reads the CURRENT role from the database rather than trusting
    // the refresh token's (possibly stale) role claim — a role change
    // between issuance and refresh takes effect immediately (WO-042 edge case).
    const tokens = this.jwtService.generateTokenPair(user.id, user.email, user.role);
    this.logger.info(
      { event: 'refresh', actorId: user.id, ip: context.ip, userAgent: context.userAgent, success: true },
      'Token refreshed',
    );

    return { user: { id: user.id, email: user.email, role: user.role }, tokens };
  }

  public logout(actorId: string | undefined, context: RequestContext): void {
    this.logger.info({ event: 'logout', actorId, ip: context.ip, userAgent: context.userAgent, success: true }, 'Logout');
  }
}
