import type { BaseEntity } from '../types.js';

export interface ToolRegistryEntry extends BaseEntity {
  name: string;
  description: string;
  spec_url: string;
  endpoints: Record<string, unknown>;
  credential_ref: string;
  health_status: string;
  last_health_check: Date | null;
}
