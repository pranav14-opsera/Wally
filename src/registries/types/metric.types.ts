import type { MetricRegistryEntry } from '../../adapters/data/index.js';

export type MetricDefinition = MetricRegistryEntry;

export type ComparisonOperator = 'eq' | 'gt' | 'lt' | 'gte' | 'lte';

export interface ThresholdConfig {
  absolute_tolerance?: number;
  percentage_tolerance?: number;
  comparison_operator?: ComparisonOperator;
  alert_on_drift?: boolean;
  [key: string]: unknown;
}

export type CreateMetricInput = Omit<MetricDefinition, 'id' | 'created_at' | 'updated_at'>;

export type UpdateMetricInput = Partial<CreateMetricInput>;
