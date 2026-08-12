import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { AuthService } from '../../../../src/gateway/auth/auth.service.js';
import { JwtService } from '../../../../src/gateway/auth/jwt.service.js';
import { AppError } from '../../../../src/gateway/utils/errors.js';
import { fakeGatewayContainer, fakeUser, fakeUserRepository } from '../../../helpers/fake-gateway-container.js';

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest' };
const PASSWORD = 'correct-horse-battery-staple';

async function newAuthService(users = [fakeUser()]) {
  const container = fakeGatewayContainer();
  const jwtService = new JwtService(container.cloudSecrets);
  await jwtService.init();
  return { authService: new AuthService(fakeUserRepository(users), jwtService, pino({ level: 'silent' })), users, jwtService };
}

describe('AuthService.login', () => {
  it('returns a token pair and public user info for valid credentials', async () => {
    const { authService, users } = await newAuthService();

    const result = await authService.login(users[0]!.email, PASSWORD, CONTEXT);

    expect(result.user).toEqual({ id: users[0]!.id, email: users[0]!.email, role: users[0]!.role });
    expect(result.tokens.accessToken).toEqual(expect.any(String));
    expect(result.tokens.refreshToken).toEqual(expect.any(String));
  });

  it('rejects an unknown email with a generic AUTHENTICATION_ERROR (no user-enumeration hint)', async () => {
    const { authService } = await newAuthService();

    await expect(authService.login('nobody@test.com', PASSWORD, CONTEXT)).rejects.toMatchObject({
      code: 'AUTHENTICATION_ERROR',
      statusCode: 401,
    });
  });

  it('rejects a wrong password with the same generic error as an unknown user', async () => {
    const { authService, users } = await newAuthService();

    let unknownUserError: AppError | undefined;
    let wrongPasswordError: AppError | undefined;
    try {
      await authService.login('nobody@test.com', PASSWORD, CONTEXT);
    } catch (error) {
      unknownUserError = error as AppError;
    }
    try {
      await authService.login(users[0]!.email, 'wrong-password-here', CONTEXT);
    } catch (error) {
      wrongPasswordError = error as AppError;
    }

    expect(unknownUserError?.message).toBe(wrongPasswordError?.message);
    expect(unknownUserError?.code).toBe(wrongPasswordError?.code);
  });

  it('rejects a locked account with 423, distinct from bad credentials', async () => {
    const { authService, users } = await newAuthService([fakeUser({ is_locked: true })]);

    await expect(authService.login(users[0]!.email, PASSWORD, CONTEXT)).rejects.toMatchObject({
      statusCode: 423,
      code: 'AUTHORIZATION_ERROR',
    });
  });
});

describe('AuthService.refresh', () => {
  it('issues a new token pair for a valid refresh token', async () => {
    const { authService, users, jwtService } = await newAuthService();
    const refreshToken = jwtService.generateRefreshToken(users[0]!.id, users[0]!.email, users[0]!.role);

    const result = await authService.refresh(refreshToken, CONTEXT);

    expect(result.user.id).toBe(users[0]!.id);
    expect(result.tokens.accessToken).toEqual(expect.any(String));
  });

  it('rejects an access token presented as a refresh token', async () => {
    const { authService, users, jwtService } = await newAuthService();
    const accessToken = jwtService.generateAccessToken(users[0]!.id, users[0]!.email, users[0]!.role);

    await expect(authService.refresh(accessToken, CONTEXT)).rejects.toBeInstanceOf(AppError);
  });

  it('reflects the user\'s CURRENT role from the database, not the token\'s original role claim (edge case)', async () => {
    const user = fakeUser({ role: 'viewer' });
    const { authService, jwtService, users } = await newAuthService([user]);
    const staleRefreshToken = jwtService.generateRefreshToken(user.id, user.email, 'viewer');

    // Role changed in the DB after the token was issued.
    users[0]!.role = 'admin';

    const result = await authService.refresh(staleRefreshToken, CONTEXT);

    expect(result.user.role).toBe('admin');
    const decoded = jwtService.verifyToken(result.tokens.accessToken, 'access');
    expect(decoded.role).toBe('admin');
  });

  it('rejects a refresh token for a user that no longer exists', async () => {
    const { authService, jwtService } = await newAuthService([]);
    const refreshToken = jwtService.generateRefreshToken('ghost-id', 'ghost@test.com', 'viewer');

    await expect(authService.refresh(refreshToken, CONTEXT)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
});

describe('AuthService.logout', () => {
  it('does not throw for a known or unknown actor', async () => {
    const { authService } = await newAuthService();
    expect(() => authService.logout('user-1', CONTEXT)).not.toThrow();
    expect(() => authService.logout(undefined, CONTEXT)).not.toThrow();
  });
});
