import type { BaseEntity } from '../types.js';

export interface AuditLog extends BaseEntity {
  // Nullable: WO-008's User FK uses onDelete SetNull, so a log entry
  // outlives the user account that produced it.
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  change_details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
}
