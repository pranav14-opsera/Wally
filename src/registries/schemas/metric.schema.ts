import { z } from 'zod';

const NAME_MAX_LENGTH = 255;
const COMPARISON_OPERATORS = ['eq', 'gt', 'lt', 'gte', 'lte'] as const;

// .passthrough() — thresholds may carry additional tool/metric-specific
// tolerance fields beyond the four well-known ones; validate the known
// shape without rejecting extras (same rationale as ToolRegistry's loose
// endpoint schema, WO-023).
const thresholdsSchema = z
  .object({
    absolute_tolerance: z.number().optional(),
    percentage_tolerance: z.number().optional(),
    comparison_operator: z.enum(COMPARISON_OPERATORS).optional(),
    alert_on_drift: z.boolean().optional(),
  })
  .passthrough();

export const createMetricSchema = z.object({
  name: z.string().min(1).max(NAME_MAX_LENGTH),
  description: z.string().min(1).optional(),
  source_query: z.string().min(1),
  dashboard_ref: z.string().min(1).optional(),
  // Normalized to `{}` when omitted (never null) — same null-vs-empty
  // consistency rationale as ToolRegistry's `endpoints` default, per
  // this WO's edge case: "Metric with null thresholds vs empty object
  // thresholds — both must be handled consistently."
  thresholds: thresholdsSchema.default({}),
});

export const updateMetricSchema = createMetricSchema.partial();

export const metricQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
});

export type CreateMetricSchema = z.infer<typeof createMetricSchema>;
export type UpdateMetricSchema = z.infer<typeof updateMetricSchema>;
export type MetricQuerySchema = z.infer<typeof metricQuerySchema>;
