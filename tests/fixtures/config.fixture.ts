import type { CreateConfigInput } from '../../src/registries/types/config.types.js';

/** Eight+ config entries covering all data_type values across multiple categories (WO-025 AC: "at least 8 config entries covering all data_type values and multiple categories"). */

export const authRateLimitFixture: CreateConfigInput = {
  key: 'rate_limits.auth_rate_limit',
  value: '10',
  data_type: 'number',
  description: 'Max auth requests per minute per IP.',
  category: 'rate_limits',
};

export const apiRateLimitFixture: CreateConfigInput = {
  key: 'rate_limits.api_rate_limit',
  value: '100',
  data_type: 'number',
  description: 'Max API requests per minute per user.',
  category: 'rate_limits',
};

export const maxVuCountFixture: CreateConfigInput = {
  key: 'agent_limits.max_vu_count',
  value: '500',
  data_type: 'number',
  description: 'Maximum virtual users for a single load test.',
  category: 'agent_limits',
};

export const jobTimeoutFixture: CreateConfigInput = {
  key: 'agent_limits.job_timeout_seconds',
  value: '600',
  data_type: 'number',
  description: 'Maximum runtime for a single agent job.',
  category: 'agent_limits',
};

export const maxConcurrentJobsFixture: CreateConfigInput = {
  key: 'agent_limits.max_concurrent_jobs',
  value: '5',
  data_type: 'number',
  description: 'Maximum agent jobs running concurrently per user.',
  category: 'agent_limits',
};

export const healthCheckTimeoutFixture: CreateConfigInput = {
  key: 'timeouts.health_check_timeout_ms',
  value: '5000',
  data_type: 'number',
  description: 'Timeout for a single health-check HTTP call.',
  category: 'timeouts',
};

export const enableCloudComputeFixture: CreateConfigInput = {
  key: 'feature_flags.enable_cloud_compute',
  value: 'false',
  data_type: 'boolean',
  description: 'Whether the ECS compute runner is available for selection.',
  category: 'feature_flags',
};

export const gatewayCorsOriginsFixture: CreateConfigInput = {
  key: 'gateway.cors_allowed_origins',
  value: '["https://app.example.com","https://staging.example.com"]',
  data_type: 'json',
  description: 'JSON array of allowed CORS origins for the gateway.',
  category: 'gateway',
};

export const emptyStringConfigFixture: CreateConfigInput = {
  key: 'gateway.default_locale',
  // Empty string is a valid 'string' value — the WO's own edge case.
  value: '',
  data_type: 'string',
  description: 'Default locale override; empty means "use system default".',
  category: 'gateway',
};
