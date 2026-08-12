import type { CreateMetricInput } from '../../src/registries/types/metric.types.js';

/** Five sample metric definitions covering different threshold configurations and source query patterns (WO-024 AC: "at least 5 sample metric definitions"). */

export const percentageDriftMetricFixture: CreateMetricInput = {
  name: 'p95_latency_ms',
  description: 'p95 request latency in milliseconds.',
  source_query: 'SELECT p95 FROM request_latency WHERE service = $1',
  dashboard_ref: 'https://grafana.example.com/d/latency',
  thresholds: { percentage_tolerance: 5, comparison_operator: 'lte', alert_on_drift: true },
};

export const absoluteToleranceMetricFixture: CreateMetricInput = {
  name: 'error_rate_pct',
  description: 'Percentage of requests resulting in a 5xx response.',
  source_query: 'SELECT (errors::float / total::float) * 100 FROM request_summary WHERE service = $1',
  dashboard_ref: 'https://grafana.example.com/d/error-rate',
  thresholds: { absolute_tolerance: 0.5, comparison_operator: 'lte', alert_on_drift: true },
};

export const noThresholdMetricFixture: CreateMetricInput = {
  name: 'total_request_count',
  description: 'Raw request count, tracked for visibility only — no drift alerting configured.',
  source_query: 'SELECT COUNT(*) FROM requests WHERE service = $1',
  thresholds: {},
};

export const mixedThresholdMetricFixture: CreateMetricInput = {
  name: 'throughput_rps',
  description: 'Requests per second, compared with both an absolute and percentage tolerance.',
  source_query: `
    -- multi-line query with a join, exercising the WO's "very long
    -- source_query (multi-line SQL with joins)" edge case
    SELECT COUNT(*)::float / EXTRACT(EPOCH FROM (MAX(r.created_at) - MIN(r.created_at)))
    FROM requests r
    JOIN services s ON s.id = r.service_id
    WHERE s.name = $1
  `,
  dashboard_ref: 'https://grafana.example.com/d/throughput',
  thresholds: {
    absolute_tolerance: 10,
    percentage_tolerance: 15,
    comparison_operator: 'gte',
    alert_on_drift: false,
  },
};

export const specialCharsSourceQueryMetricFixture: CreateMetricInput = {
  name: "orders_containing_o'brien",
  // Deliberately includes single quotes, a semicolon, and a backslash —
  // the WO's "source_query containing special characters" edge case —
  // to prove the value is stored/retrieved verbatim, never escaped or
  // mangled by this service.
  source_query: "SELECT * FROM orders WHERE customer_name LIKE 'O''Brien%' AND note NOT LIKE '%\\\\%'; -- trailing comment",
  thresholds: { comparison_operator: 'eq' },
};
