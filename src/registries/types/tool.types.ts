import type { ToolRegistryEntry } from '../../adapters/data/index.js';

export type ToolDefinition = ToolRegistryEntry;

export type AuthType = 'api_key' | 'oauth2' | 'basic' | 'none';

export interface ToolEndpoint {
  name: string;
  method: string;
  path: string;
  [key: string]: unknown;
}

export type CreateToolInput = Omit<
  ToolDefinition,
  'id' | 'created_at' | 'updated_at' | 'health_status' | 'last_health_check'
>;

export type UpdateToolInput = Partial<CreateToolInput>;
