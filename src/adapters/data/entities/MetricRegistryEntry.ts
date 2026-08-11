import type { BaseEntity } from '../types.js';

export interface MetricRegistryEntry extends BaseEntity {
  name: string;
  description: string;
  source_query: string;
  dashboard_ref: string | null;
  thresholds: Record<string, unknown>;
}
