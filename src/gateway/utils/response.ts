import type { ErrorDetail, ErrorResponse, PaginationMeta, SuccessResponse } from '../types.js';

export function success<T>(data: T, requestId: string, meta?: PaginationMeta): SuccessResponse<T> {
  return meta === undefined ? { success: true, data, requestId } : { success: true, data, meta, requestId };
}

export function error(code: string, message: string, requestId: string, details: ErrorDetail[] = []): ErrorResponse {
  return { success: false, error: { code, message, details }, requestId };
}

/** `total: 0` (edge case: empty result set) correctly yields `totalPages: 0`, not `1`, since there is nothing to page through. */
export function paginated(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
}
