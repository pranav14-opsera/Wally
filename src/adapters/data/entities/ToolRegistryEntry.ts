import type { BaseEntity } from '../types.js';

export interface ToolRegistryEntry extends BaseEntity {
  name: string;
  description: string | null;
  type: string;
  base_url: string;
  auth_type: string;
  endpoints: Array<Record<string, unknown>>;
  credential_ref: string | null;
  health_status: string;
  last_health_check: Date | null;
}
