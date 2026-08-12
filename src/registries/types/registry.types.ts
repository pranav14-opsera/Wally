/**
 * Shared types every registry service (Tool/WO-023, Metric/WO-024,
 * Config/WO-025, Spec/WO-026) uses — Tool is the pattern-setter, the
 * other three follow this file's shapes exactly rather than each
 * defining their own.
 */

export type RegistryErrorCode = 'DUPLICATE_ENTRY' | 'NOT_FOUND' | 'VALIDATION_ERROR';

/**
 * Thrown by every registry service instead of letting a raw
 * `DataAdapterError` (or database driver exception) escape to callers —
 * per the WO's error_handling section, "Never expose raw database error
 * messages to callers."
 */
export class RegistryError extends Error {
  public constructor(
    message: string,
    public readonly code: RegistryErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Offset-based pagination result shape for registry `list()` methods — distinct from the data-adapter's own `PaginatedResult<T>` (which uses hasNext/nextCursor for both offset and cursor modes); registries only ever page by page/limit. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

/** One immutable audit record — never updated or deleted once written. */
export interface AuditEntry {
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  change_details: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

/**
 * Audit log write failures are logged as warnings but never fail the
 * primary registry operation (fire-and-forget with error logging, per
 * the WO's error_handling section) — so `log()` itself never rejects.
 */
export interface IAuditLogger {
  log(entry: AuditEntry): Promise<void>;
}
