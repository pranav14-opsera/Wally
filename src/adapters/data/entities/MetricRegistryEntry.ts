import type { BaseEntity } from '../types.js';

export interface MetricRegistryEntry extends BaseEntity {
  name: string;
  description: string;
  source_query: string;
  dashboard_ref: string;
  thresholds: Record<string, unknown>;
}
