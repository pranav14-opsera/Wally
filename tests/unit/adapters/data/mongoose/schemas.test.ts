import mongoose from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';

import { agentJobSchema } from '../../../../../src/adapters/data/mongoose/schemas/AgentJob.schema.js';
import { createAuditLogSchema } from '../../../../../src/adapters/data/mongoose/schemas/AuditLog.schema.js';
import { configRegistrySchema } from '../../../../../src/adapters/data/mongoose/schemas/ConfigRegistry.schema.js';
import { driftEventSchema } from '../../../../../src/adapters/data/mongoose/schemas/DriftEvent.schema.js';
import { jobStepSchema } from '../../../../../src/adapters/data/mongoose/schemas/JobStep.schema.js';
import { loadTestResultSchema } from '../../../../../src/adapters/data/mongoose/schemas/LoadTestResult.schema.js';
import { metricRegistrySchema } from '../../../../../src/adapters/data/mongoose/schemas/MetricRegistry.schema.js';
import { specRegistrySchema } from '../../../../../src/adapters/data/mongoose/schemas/SpecRegistry.schema.js';
import { toolRegistrySchema } from '../../../../../src/adapters/data/mongoose/schemas/ToolRegistry.schema.js';
import { userSchema } from '../../../../../src/adapters/data/mongoose/schemas/User.schema.js';

/** True if `schema` declares an index (via schema.index() or a field-level `unique`/`index` option) matching `fields`. */
function hasIndexOn(schema: mongoose.Schema, fields: Record<string, unknown>): boolean {
  return schema.indexes().some(([idxFields]) => JSON.stringify(idxFields) === JSON.stringify(fields));
}

function hasUniqueIndexOn(schema: mongoose.Schema, fields: Record<string, unknown>): boolean {
  return schema
    .indexes()
    .some(
      ([idxFields, idxOptions]) =>
        JSON.stringify(idxFields) === JSON.stringify(fields) &&
        (idxOptions as { unique?: boolean }).unique === true,
    );
}

/** Runs schema validation via the (non-deprecated) async `validate()` API, returning the field-error map on failure or undefined on success. */
async function validationErrorsOf(doc: mongoose.Document): Promise<Record<string, mongoose.Error.ValidatorError | mongoose.Error.CastError> | undefined> {
  try {
    await doc.validate();
    return undefined;
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return error.errors;
    }
    throw error;
  }
}

describe('User schema', () => {
  let UserModel: mongoose.Model<mongoose.InferSchemaType<typeof userSchema>>;

  beforeAll(() => {
    UserModel = mongoose.model('SchemaTest_User', userSchema);
  });

  it('validates a document with all required fields present', async () => {
    const doc = new UserModel({ email: 'a@example.com', name: 'Ada', password_hash: 'hash' });
    expect(await validationErrorsOf(doc)).toBeUndefined();
  });

  it('rejects a document missing required fields', async () => {
    const errors = await validationErrorsOf(new UserModel({}));
    expect(errors?.email).toBeDefined();
    expect(errors?.name).toBeDefined();
    expect(errors?.password_hash).toBeDefined();
  });

  it('rejects a role outside the UserRole enum', async () => {
    const doc = new UserModel({ email: 'a@example.com', name: 'Ada', password_hash: 'hash', role: 'superadmin' });
    expect((await validationErrorsOf(doc))?.role).toBeDefined();
  });

  it('applies defaults: role=viewer, is_locked=false, failed_login_attempts=0', () => {
    const doc = new UserModel({ email: 'a@example.com', name: 'Ada', password_hash: 'hash' });
    expect(doc.role).toBe('viewer');
    expect(doc.is_locked).toBe(false);
    expect(doc.failed_login_attempts).toBe(0);
  });

  it('declares a unique index on email', () => {
    expect(hasUniqueIndexOn(userSchema, { email: 1 })).toBe(true);
  });
});

describe('AgentJob schema (embedded job_steps and drift_events)', () => {
  let AgentJobModel: mongoose.Model<mongoose.InferSchemaType<typeof agentJobSchema>>;

  beforeAll(() => {
    AgentJobModel = mongoose.model('SchemaTest_AgentJob', agentJobSchema);
  });

  it('validates a document with all required fields present', async () => {
    const doc = new AgentJobModel({ user_id: 'u-1', agent_type: 'integration', total_steps: 3 });
    expect(await validationErrorsOf(doc)).toBeUndefined();
  });

  it('rejects an agent_type outside the AgentType enum', async () => {
    const doc = new AgentJobModel({ user_id: 'u-1', agent_type: 'not-a-real-type', total_steps: 1 });
    expect((await validationErrorsOf(doc))?.agent_type).toBeDefined();
  });

  it('applies defaults: status=queued, current_step=0', () => {
    const doc = new AgentJobModel({ user_id: 'u-1', agent_type: 'integration', total_steps: 1 });
    expect(doc.status).toBe('queued');
    expect(doc.current_step).toBe(0);
  });

  it('accepts embedded job_steps as an ordered subdocument array, each with its own id', async () => {
    const doc = new AgentJobModel({
      user_id: 'u-1',
      agent_type: 'integration',
      total_steps: 2,
      job_steps: [
        { step_order: 1, step_name: 'validate' },
        { step_order: 2, step_name: 'execute' },
      ],
    });

    expect(await validationErrorsOf(doc)).toBeUndefined();
    expect(doc.job_steps).toHaveLength(2);
    expect(doc.job_steps[0]?.step_order).toBe(1);
    expect(doc.job_steps[0]?.id).toBeDefined();
    expect(doc.job_steps[0]?.status).toBe('pending');
  });

  it('accepts embedded drift_events with a reference to metric_registry', async () => {
    const doc = new AgentJobModel({
      user_id: 'u-1',
      agent_type: 'validation',
      total_steps: 1,
      drift_events: [
        {
          metric_id: 'metric-1',
          source_value: 10,
          dashboard_value: 12,
          drift_type: 'value_mismatch',
          affected_records: { count: 3 },
        },
      ],
    });

    expect(await validationErrorsOf(doc)).toBeUndefined();
    expect(doc.drift_events[0]?.metric_id).toBe('metric-1');
  });

  it('rejects an embedded job_steps array beyond the defensive 16MB-limit cap', async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ step_order: i, step_name: `step-${i}` }));
    const doc = new AgentJobModel({ user_id: 'u-1', agent_type: 'integration', total_steps: 1, job_steps: tooMany });
    expect((await validationErrorsOf(doc))?.job_steps).toBeDefined();
  });

  it('declares the required compound indexes', () => {
    expect(hasIndexOn(agentJobSchema, { agent_type: 1, status: 1, created_at: 1 })).toBe(true);
    expect(hasIndexOn(agentJobSchema, { user_id: 1, created_at: 1 })).toBe(true);
  });
});

describe('JobStep subdocument schema', () => {
  it('rejects a document missing required fields', async () => {
    const AgentJobModel = mongoose.model('SchemaTest_AgentJob_ForStepValidation', agentJobSchema);
    const doc = new AgentJobModel({
      user_id: 'u-1',
      agent_type: 'integration',
      total_steps: 1,
      job_steps: [{}],
    });
    const errors = await validationErrorsOf(doc);
    expect(errors?.['job_steps.0.step_order']).toBeDefined();
    expect(errors?.['job_steps.0.step_name']).toBeDefined();
  });

  it('has no job_id field — implicit via the parent AgentJob document', () => {
    expect(jobStepSchema.path('job_id')).toBeUndefined();
  });

  it('rejects a status outside the StepStatus enum', async () => {
    const StandaloneJobStep = mongoose.model('SchemaTest_JobStepStandalone', jobStepSchema);
    const doc = new StandaloneJobStep({ step_order: 1, step_name: 'x', status: 'not-a-real-status' });
    expect((await validationErrorsOf(doc))?.status).toBeDefined();
  });
});

describe('DriftEvent subdocument schema', () => {
  it('has no job_id field — implicit via the parent AgentJob document', () => {
    expect(driftEventSchema.path('job_id')).toBeUndefined();
  });

  it('requires metric_id, source_value, dashboard_value, drift_type, and affected_records', async () => {
    const StandaloneDriftEvent = mongoose.model('SchemaTest_DriftEventStandalone', driftEventSchema);
    const errors = await validationErrorsOf(new StandaloneDriftEvent({}));
    expect(errors?.metric_id).toBeDefined();
    expect(errors?.source_value).toBeDefined();
    expect(errors?.dashboard_value).toBeDefined();
    expect(errors?.drift_type).toBeDefined();
    expect(errors?.affected_records).toBeDefined();
  });
});

describe('ToolRegistry schema', () => {
  it('requires name, description, and endpoints', async () => {
    const ToolRegistryModel = mongoose.model('SchemaTest_ToolRegistry', toolRegistrySchema);
    const errors = await validationErrorsOf(new ToolRegistryModel({}));
    expect(errors?.name).toBeDefined();
    expect(errors?.description).toBeDefined();
    expect(errors?.endpoints).toBeDefined();
  });

  it('defaults health_status to unknown', () => {
    const ToolRegistryModel = mongoose.model('SchemaTest_ToolRegistry2', toolRegistrySchema);
    const doc = new ToolRegistryModel({ name: 'x', description: 'y', endpoints: {} });
    expect(doc.health_status).toBe('unknown');
  });

  it('declares a unique index on name', () => {
    expect(hasUniqueIndexOn(toolRegistrySchema, { name: 1 })).toBe(true);
  });
});

describe('MetricRegistry schema', () => {
  it('requires name, description, source_query, and thresholds', async () => {
    const MetricRegistryModel = mongoose.model('SchemaTest_MetricRegistry', metricRegistrySchema);
    const errors = await validationErrorsOf(new MetricRegistryModel({}));
    expect(errors?.name).toBeDefined();
    expect(errors?.description).toBeDefined();
    expect(errors?.source_query).toBeDefined();
    expect(errors?.thresholds).toBeDefined();
  });

  it('declares a unique index on name', () => {
    expect(hasUniqueIndexOn(metricRegistrySchema, { name: 1 })).toBe(true);
  });
});

describe('ConfigRegistry schema', () => {
  it('requires key, value, and data_type', async () => {
    const ConfigRegistryModel = mongoose.model('SchemaTest_ConfigRegistry', configRegistrySchema);
    const errors = await validationErrorsOf(new ConfigRegistryModel({}));
    expect(errors?.key).toBeDefined();
    expect(errors?.value).toBeDefined();
    expect(errors?.data_type).toBeDefined();
  });

  it("declares a unique index on key — required for parity with the Postgres schema (WO-008), though not explicit in WO-010's AC bullet list", () => {
    expect(hasUniqueIndexOn(configRegistrySchema, { key: 1 })).toBe(true);
  });
});

describe('SpecRegistry schema', () => {
  it('requires api_name, version, spec_content, and checksum', async () => {
    const SpecRegistryModel = mongoose.model('SchemaTest_SpecRegistry', specRegistrySchema);
    const errors = await validationErrorsOf(new SpecRegistryModel({}));
    expect(errors?.api_name).toBeDefined();
    expect(errors?.version).toBeDefined();
    expect(errors?.spec_content).toBeDefined();
    expect(errors?.checksum).toBeDefined();
  });

  it('declares a unique compound index on (api_name, version)', () => {
    expect(hasUniqueIndexOn(specRegistrySchema, { api_name: 1, version: 1 })).toBe(true);
  });
});

describe('LoadTestResult schema', () => {
  it('requires job_id and all latency/throughput/verdict fields', async () => {
    const LoadTestResultModel = mongoose.model('SchemaTest_LoadTestResult', loadTestResultSchema);
    const errors = await validationErrorsOf(new LoadTestResultModel({}));
    expect(errors?.job_id).toBeDefined();
    expect(errors?.p50_latency_ms).toBeDefined();
    expect(errors?.slo_verdict).toBeDefined();
  });

  it('rejects an slo_verdict outside the SloVerdict enum', async () => {
    const LoadTestResultModel2 = mongoose.model('SchemaTest_LoadTestResult2', loadTestResultSchema);
    const doc = new LoadTestResultModel2({
      job_id: 'j-1',
      profile_config: {},
      p50_latency_ms: 1,
      p95_latency_ms: 1,
      p99_latency_ms: 1,
      throughput_rps: 1,
      error_rate_pct: 0,
      slo_verdict: 'maybe',
      raw_metrics: {},
    });
    expect((await validationErrorsOf(doc))?.slo_verdict).toBeDefined();
  });
});

describe('AuditLog schema factory', () => {
  const RETENTION_DAYS = 90;
  const SECONDS_PER_DAY = 86_400;

  it('requires action and resource_type', async () => {
    const schema = createAuditLogSchema(RETENTION_DAYS);
    const AuditLogModel = mongoose.model('SchemaTest_AuditLog', schema);
    const errors = await validationErrorsOf(new AuditLogModel({}));
    expect(errors?.action).toBeDefined();
    expect(errors?.resource_type).toBeDefined();
  });

  it('allows actor_id to be null (SetNull parity with the Postgres FK behavior)', async () => {
    const schema = createAuditLogSchema(RETENTION_DAYS);
    const AuditLogModel = mongoose.model('SchemaTest_AuditLog2', schema);
    const doc = new AuditLogModel({ actor_id: null, action: 'login', resource_type: 'session' });
    expect(await validationErrorsOf(doc)).toBeUndefined();
  });

  it('declares compound indexes on (actor_id, created_at) and (resource_type, resource_id)', () => {
    const schema = createAuditLogSchema(RETENTION_DAYS);
    expect(hasIndexOn(schema, { actor_id: 1, created_at: 1 })).toBe(true);
    expect(hasIndexOn(schema, { resource_type: 1, resource_id: 1 })).toBe(true);
  });

  it('computes the TTL index expireAfterSeconds from the given retention days', () => {
    const schema = createAuditLogSchema(RETENTION_DAYS);
    const ttlIndex = schema
      .indexes()
      .find(([fields]) => JSON.stringify(fields) === JSON.stringify({ created_at: 1 }));
    expect(ttlIndex?.[1]).toMatchObject({ expireAfterSeconds: RETENTION_DAYS * SECONDS_PER_DAY });
  });

  it('produces a different expireAfterSeconds for a different retention value', () => {
    const schema30 = createAuditLogSchema(30);
    const ttlIndex = schema30
      .indexes()
      .find(([fields]) => JSON.stringify(fields) === JSON.stringify({ created_at: 1 }));
    expect(ttlIndex?.[1]).toMatchObject({ expireAfterSeconds: 30 * SECONDS_PER_DAY });
  });
});
