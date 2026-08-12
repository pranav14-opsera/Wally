export interface ErrorDetail {
  field: string;
  message: string;
}

interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: unknown;
  requestId: string;
}

interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details: ErrorDetail[] };
  requestId: string;
}

export class ApiRequestError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: ErrorDetail[];

  public constructor(code: string, message: string, status: number, details: ErrorDetail[] = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Every request goes through the Vite dev proxy (`/api` -> the gateway),
 * so this is same-origin from the browser's point of view — the gateway's
 * httpOnly auth cookies are sent automatically, no CORS/credentials
 * wrangling needed here. The CSRF token lives in a deliberately
 * non-httpOnly cookie (double-submit pattern) so it can be read here and
 * echoed back on state-changing requests.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCookie('csrf_token');
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  const response = await fetch(path, { ...options, headers });
  const body = (await response.json()) as ApiSuccess<T> | ApiErrorBody;

  if (!body.success) {
    throw new ApiRequestError(body.error.code, body.error.message, response.status, body.error.details);
  }

  return body.data;
}
