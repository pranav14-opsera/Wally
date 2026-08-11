import type {
  AgentJob,
  AuditLog,
  ConfigRegistryEntry,
  DriftEvent,
  JobStep,
  LoadTestResult,
  MetricRegistryEntry,
  SpecRegistryEntry,
  ToolRegistryEntry,
  User,
} from '../../../src/adapters/data/index.js';

/**
 * One valid sample instance per entity (WO-007). Reused by WO-009,
 * WO-011, and WO-012's contract tests to exercise the same fixtures
 * against both the Prisma and Mongoose adapters.
 */

const NOW = new Date('2026-08-11T12:00:00.000Z');

export function createUserFixture(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane.doe@example.com',
    name: 'Jane Doe',
    password_hash: '$2b$10$examplehashvalueexamplehashvalue',
    role: 'admin',
    is_locked: false,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createAgentJobFixture(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    agent_type: 'integration',
    status: 'queued',
    input_params: { toolName: 'example-tool' },
    result_summary: null,
    current_step: 0,
    total_steps: 6,
    error_message: null,
    queued_at: NOW,
    started_at: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createJobStepFixture(overrides: Partial<JobStep> = {}): JobStep {
  return {
    id: 'step-1',
    job_id: 'job-1',
    step_order: 1,
    step_name: 'validate_openapi_spec',
    status: 'pending',
    input_data: {},
    output_data: null,
    error_message: null,
    duration_ms: null,
    started_at: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createToolRegistryEntryFixture(
  overrides: Partial<ToolRegistryEntry> = {},
): ToolRegistryEntry {
  return {
    id: 'tool-1',
    name: 'example-tool',
    description: 'An example third-party tool for integration testing.',
    spec_url: 'https://api.example.com/openapi.json',
    endpoints: { health: '/health', trigger: '/trigger' },
    credential_ref: 'secrets/example-tool-api-key',
    health_status: 'healthy',
    last_health_check: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createMetricRegistryEntryFixture(
  overrides: Partial<MetricRegistryEntry> = {},
): MetricRegistryEntry {
  return {
    id: 'metric-1',
    name: 'p95_latency_ms',
    description: 'p95 request latency in milliseconds.',
    source_query: 'SELECT p95 FROM request_latency WHERE service = $1',
    dashboard_ref: 'https://grafana.example.com/d/latency',
    thresholds: { warning: 200, critical: 500 },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createConfigRegistryEntryFixture(
  overrides: Partial<ConfigRegistryEntry> = {},
): ConfigRegistryEntry {
  return {
    id: 'config-1',
    key: 'MAX_CONCURRENT_LOAD_TEST_VUS',
    value: '500',
    data_type: 'number',
    description: 'Maximum virtual users allowed in a single load test run.',
    category: 'load_testing',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createSpecRegistryEntryFixture(
  overrides: Partial<SpecRegistryEntry> = {},
): SpecRegistryEntry {
  return {
    id: 'spec-1',
    api_name: 'example-tool-api',
    version: '1.2.0',
    spec_content: { openapi: '3.0.0', info: { title: 'Example Tool API' } },
    checksum: 'sha256:examplechecksumvalue',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createAuditLogFixture(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'audit-1',
    actor_id: 'user-1',
    action: 'tool.create',
    resource_type: 'ToolRegistryEntry',
    resource_id: 'tool-1',
    change_details: { after: { name: 'example-tool' } },
    ip_address: '203.0.113.5',
    user_agent: 'Mozilla/5.0',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createDriftEventFixture(overrides: Partial<DriftEvent> = {}): DriftEvent {
  return {
    id: 'drift-1',
    job_id: 'job-1',
    metric_id: 'metric-1',
    source_value: '142.3',
    dashboard_value: '210.7',
    drift_type: 'value_mismatch',
    affected_records: { count: 3 },
    detected_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createLoadTestResultFixture(
  overrides: Partial<LoadTestResult> = {},
): LoadTestResult {
  return {
    id: 'load-test-1',
    job_id: 'job-1',
    profile_config: { vus: 50, duration: '5m' },
    p50_latency_ms: 45.2,
    p95_latency_ms: 142.3,
    p99_latency_ms: 210.7,
    throughput_rps: 320.5,
    error_rate_pct: 0.2,
    slo_verdict: 'pass',
    raw_metrics: { checks_passed: 15000, checks_failed: 30 },
    executed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}
