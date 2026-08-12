import { randomBytes } from 'node:crypto';

import type { FastifyReply } from 'fastify';

import type { TokenPair } from './jwt.service.js';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

const ACCESS_TOKEN_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const AUTH_COOKIE_PATH = '/';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const CSRF_TOKEN_BYTES = 32;

export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('hex');
}

/** `secure: isProduction` — Secure cookies are dropped by browsers over plain HTTP, which local dev runs on; only require it once the gateway is actually served over HTTPS. */
export function setTokenCookies(reply: FastifyReply, tokens: TokenPair, isProduction: boolean): void {
  reply.setCookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: AUTH_COOKIE_PATH,
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  });
  reply.setCookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

/** Deliberately NOT httpOnly — the double-submit CSRF pattern requires client-side JS to read this cookie and echo it back in the `X-CSRF-Token` header; only the two matching proves the request came from the SPA, not a cross-site form. */
export function setCsrfCookie(reply: FastifyReply, token: string, isProduction: boolean): void {
  reply.setCookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'strict',
    path: AUTH_COOKIE_PATH,
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  });
}

export function clearTokenCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_TOKEN_COOKIE, { path: AUTH_COOKIE_PATH });
  reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_COOKIE_PATH });
  reply.clearCookie(CSRF_COOKIE, { path: AUTH_COOKIE_PATH });
}
