import type { BaseEntity } from '../types.js';

export interface ConfigRegistryEntry extends BaseEntity {
  key: string;
  value: string;
  data_type: string;
  description: string | null;
  category: string | null;
}
