import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyPluginAsync } from 'fastify';

import { ApiLifecycleAgent } from '../../agents/api-lifecycle/api-lifecycle-agent.js';
import { createApiLifecycleRunRequestSchema } from '../../agents/api-lifecycle/schemas.js';
import { IntegrationAgent } from '../../agents/integration/integration-agent.js';
import { createIntegrationRunRequestSchema } from '../../agents/integration/schemas.js';
import { LoadTestAgent } from '../../agents/load-testing/load-test-agent.js';
import { createLoadTestProfileSchema } from '../../agents/load-testing/schemas.js';
import { Role } from '../auth/roles.js';
import { jobEventBus } from '../events/job-events.js';
import { paginationQuerySchema, uuidParamsSchema } from '../schemas/index.js';
import { AppError } from '../utils/errors.js';
import { paginated, success } from '../utils/response.js';

const LOAD_TEST_AGENT_TYPE = 'load_testing';
const INTEGRATION_AGENT_TYPE = 'integration';
const API_LIFECYCLE_AGENT_TYPE = 'api_lifecycle';

/**
 * Agent REST endpoints for all three implemented agents. Every trigger
 * follows the same shape: create the `AgentJob` row, kick off the agent
 * fire-and-forget, return 202 immediately — the client watches progress
 * over SSE (`/api/v1/events/jobs/:id`) and polls the detail endpoint,
 * never holds this request open for the run's duration.
 */
export const agentRoutes: FastifyPluginAsync = async (app) => {
  const { container } = app;
  const { agentJobs, jobSteps, loadTestResults, toolRegistry, specRegistry } = container.dataAdapter.repositories;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const loadTestProfileSchema = createLoadTestProfileSchema(container.config);
  const integrationRunRequestSchema = createIntegrationRunRequestSchema(container.config);
  const apiLifecycleRunRequestSchema = createApiLifecycleRunRequestSchema(container.config);
  const specFetchOptions = {
    maxEndpoints: container.config.SPEC_MAX_ENDPOINTS_TO_SHOW,
    fetchTimeoutMs: container.config.SPEC_FETCH_TIMEOUT_MS,
    summaryMaxLength: container.config.SPEC_SUMMARY_MAX_LENGTH,
    responseShapeMaxFields: container.config.SPEC_RESPONSE_SHAPE_MAX_FIELDS,
  };
  const apiLifecycleSpecFetchOptions = { ...specFetchOptions, maxEndpoints: container.config.API_LIFECYCLE_MAX_ENDPOINTS_TO_DIFF };

  // --- Load Testing Agent (WO-096) ---------------------------------------

  typed.post(
    '/load-testing/runs',
    { config: { requiredRole: Role.MANAGER }, schema: { body: loadTestProfileSchema } },
    async (request, reply) => {
      const profile = request.body;
      const job = await agentJobs.create({
        user_id: request.user!.sub,
        agent_type: LOAD_TEST_AGENT_TYPE,
        status: 'queued',
        input_params: profile as unknown as Record<string, unknown>,
        result_summary: null,
        current_step: 0,
        total_steps: 0,
        error_message: null,
        queued_at: new Date(),
        started_at: null,
        completed_at: null,
      });

      const agent = new LoadTestAgent({
        jobId: job.id,
        agentJobs,
        jobSteps,
        loadTestResults,
        logger: container.logger,
        events: jobEventBus,
        k6BinaryPath: container.config.K6_BINARY_PATH,
        computeTimeoutMs: container.config.COMPUTE_TASK_TIMEOUT_MS,
        progressIntervalMs: container.config.LOADTEST_PROGRESS_INTERVAL_MS,
        stderrTailLength: container.config.LOADTEST_STDERR_TAIL_LENGTH,
        minStepDurationMs: container.config.AGENT_MIN_STEP_DURATION_MS,
      });

      agent.run({ profile }).catch((error: unknown) => {
        container.logger.error({ err: error, jobId: job.id }, 'Load test agent run failed');
      });

      reply.status(202);
      return success({ jobId: job.id }, request.requestId);
    },
  );

  typed.get(
    '/load-testing/runs',
    { config: { requiredRole: Role.VIEWER }, schema: { querystring: paginationQuerySchema } },
    async (request) => {
      const { page, limit } = request.query;
      const result = await agentJobs.findMany(
        { agent_type: { operator: 'eq', value: LOAD_TEST_AGENT_TYPE } },
        { created_at: 'desc' },
        { kind: 'offset', limit, offset: (page - 1) * limit },
      );
      return success(result.items, request.requestId, paginated(page, limit, result.total));
    },
  );

  typed.get(
    '/load-testing/runs/:id',
    { config: { requiredRole: Role.VIEWER }, schema: { params: uuidParamsSchema } },
    async (request) => {
      const job = await agentJobs.findByIdWithSteps(request.params.id);
      if (!job) {
        throw new AppError('Load test run not found', 'NOT_FOUND', 404);
      }
      const results = await loadTestResults.findMany(
        { job_id: { operator: 'eq', value: job.id } },
        { created_at: 'desc' },
        { kind: 'offset', limit: 1, offset: 0 },
      );
      return success({ job, result: results.items[0] ?? null }, request.requestId);
    },
  );

  // --- Integration Agent (WO-068-071/073) --------------------------------

  typed.post(
    '/integration/runs',
    { config: { requiredRole: Role.MANAGER }, schema: { body: integrationRunRequestSchema } },
    async (request, reply) => {
      const runRequest = request.body;
      const job = await agentJobs.create({
        user_id: request.user!.sub,
        agent_type: INTEGRATION_AGENT_TYPE,
        status: 'queued',
        input_params: runRequest as unknown as Record<string, unknown>,
        result_summary: null,
        current_step: 0,
        total_steps: 0,
        error_message: null,
        queued_at: new Date(),
        started_at: null,
        completed_at: null,
      });

      const agent = new IntegrationAgent({
        jobId: job.id,
        agentJobs,
        jobSteps,
        toolRegistry,
        cloudSecrets: container.cloudSecrets,
        logger: container.logger,
        events: jobEventBus,
        minStepDurationMs: container.config.AGENT_MIN_STEP_DURATION_MS,
        specFetchOptions,
      });

      agent.run({ request: runRequest }).catch((error: unknown) => {
        container.logger.error({ err: error, jobId: job.id }, 'Integration agent run failed');
      });

      reply.status(202);
      return success({ jobId: job.id }, request.requestId);
    },
  );

  typed.get(
    '/integration/runs',
    { config: { requiredRole: Role.VIEWER }, schema: { querystring: paginationQuerySchema } },
    async (request) => {
      const { page, limit } = request.query;
      const result = await agentJobs.findMany(
        { agent_type: { operator: 'eq', value: INTEGRATION_AGENT_TYPE } },
        { created_at: 'desc' },
        { kind: 'offset', limit, offset: (page - 1) * limit },
      );
      return success(result.items, request.requestId, paginated(page, limit, result.total));
    },
  );

  typed.get(
    '/integration/runs/:id',
    { config: { requiredRole: Role.VIEWER }, schema: { params: uuidParamsSchema } },
    async (request) => {
      const job = await agentJobs.findByIdWithSteps(request.params.id);
      if (!job) {
        throw new AppError('Integration run not found', 'NOT_FOUND', 404);
      }
      return success({ job, result: job.result_summary }, request.requestId);
    },
  );

  // --- API Lifecycle Agent (WO-100-103) ----------------------------------

  typed.post(
    '/api-lifecycle/runs',
    { config: { requiredRole: Role.MANAGER }, schema: { body: apiLifecycleRunRequestSchema } },
    async (request, reply) => {
      const runRequest = request.body;
      const job = await agentJobs.create({
        user_id: request.user!.sub,
        agent_type: API_LIFECYCLE_AGENT_TYPE,
        status: 'queued',
        input_params: runRequest as unknown as Record<string, unknown>,
        result_summary: null,
        current_step: 0,
        total_steps: 0,
        error_message: null,
        queued_at: new Date(),
        started_at: null,
        completed_at: null,
      });

      const agent = new ApiLifecycleAgent({
        jobId: job.id,
        agentJobs,
        jobSteps,
        specRegistry,
        logger: container.logger,
        events: jobEventBus,
        minStepDurationMs: container.config.AGENT_MIN_STEP_DURATION_MS,
        specFetchOptions: apiLifecycleSpecFetchOptions,
      });

      agent.run({ request: runRequest }).catch((error: unknown) => {
        container.logger.error({ err: error, jobId: job.id }, 'API Lifecycle agent run failed');
      });

      reply.status(202);
      return success({ jobId: job.id }, request.requestId);
    },
  );

  typed.get(
    '/api-lifecycle/runs',
    { config: { requiredRole: Role.VIEWER }, schema: { querystring: paginationQuerySchema } },
    async (request) => {
      const { page, limit } = request.query;
      const result = await agentJobs.findMany(
        { agent_type: { operator: 'eq', value: API_LIFECYCLE_AGENT_TYPE } },
        { created_at: 'desc' },
        { kind: 'offset', limit, offset: (page - 1) * limit },
      );
      return success(result.items, request.requestId, paginated(page, limit, result.total));
    },
  );

  typed.get(
    '/api-lifecycle/runs/:id',
    { config: { requiredRole: Role.VIEWER }, schema: { params: uuidParamsSchema } },
    async (request) => {
      const job = await agentJobs.findByIdWithSteps(request.params.id);
      if (!job) {
        throw new AppError('API Lifecycle run not found', 'NOT_FOUND', 404);
      }
      return success({ job, result: job.result_summary }, request.requestId);
    },
  );
};
