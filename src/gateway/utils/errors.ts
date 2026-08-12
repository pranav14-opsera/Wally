import type { ErrorDetail } from '../types.js';

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'TOKEN_EXPIRED'
  | 'CSRF_VALIDATION_FAILED';

/** Every intentionally-thrown gateway error — route handlers throw this instead of a bare `Error` so the global error handler (WO-039) knows the exact status code and machine-readable code to respond with. */
export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly statusCode: number;
  public readonly details: ErrorDetail[];

  public constructor(message: string, code: AppErrorCode, statusCode: number, details: ErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
