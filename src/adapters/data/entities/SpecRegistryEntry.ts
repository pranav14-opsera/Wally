import type { BaseEntity } from '../types.js';

export interface SpecRegistryEntry extends BaseEntity {
  api_name: string;
  version: string;
  spec_content: Record<string, unknown>;
  checksum: string;
}
