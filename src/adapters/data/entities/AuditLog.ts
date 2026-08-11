import type { BaseEntity } from '../types.js';

export interface AuditLog extends BaseEntity {
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  change_details: Record<string, unknown>;
  ip_address: string;
  user_agent: string;
}
