import type { Logger } from 'pino';

import type { ICloudSecretsService } from '../../adapters/cloud/index.js';
import type { IAgentJobRepository, IRepository, JobStep, ToolRegistryEntry } from '../../adapters/data/index.js';
import type { JobEventBus } from '../../gateway/events/job-events.js';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentStepDefinition } from '../base/types.js';
import type { DiscoveredEndpoint, DiscoverToolSpecOptions, DiscoveredSpec } from './spec-fetcher.js';
import { discoverToolSpec } from './spec-fetcher.js';
import type { IntegrationRunRequest } from './schemas.js';

export interface IntegrationContext {
  request: IntegrationRunRequest;
}

export interface LiveTestResult {
  attempted: boolean;
  description: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface IntegrationReport {
  toolName: string;
  specFound: boolean;
  specUrl: string | null;
  attemptedUrls: string[];
  totalEndpointCount: number;
  endpoints: DiscoveredEndpoint[];
  credentialStored: boolean;
  liveTest: LiveTestResult;
  registryEntryId: string | null;
}

export interface IntegrationAgentDeps {
  jobId: string;
  agentJobs: IAgentJobRepository;
  jobSteps: IRepository<JobStep>;
  toolRegistry: IRepository<ToolRegistryEntry>;
  cloudSecrets: ICloudSecretsService;
  logger: Logger;
  events: JobEventBus;
  minStepDurationMs: number;
  specFetchOptions: DiscoverToolSpecOptions;
}

/**
 * Integration Agent (WO-068-071/073): given ANY free-text tool name,
 * fetch that vendor's REAL public OpenAPI specification (a small
 * registry of verified official spec URLs — see `known-specs.ts` — with
 * a genuine fetch attempt against common hosting conventions for names
 * outside it), parse its real endpoint list and response shapes, make a
 * real unauthenticated HTTP call against it where one safely exists, and
 * register the tool. When no public spec can be found (true for closed
 * APIs like OpenAI's Codex-family completions endpoints or xAI without a
 * key), the report says so honestly instead of inventing endpoints.
 */
export class IntegrationAgent extends BaseAgent<IntegrationContext> {
  protected readonly steps: ReadonlyArray<AgentStepDefinition<IntegrationContext>>;

  private discovered: DiscoveredSpec | undefined;
  private liveTest: LiveTestResult = { attempted: false, description: null, statusCode: null, latencyMs: null, error: null };
  private registryEntryId: string | null = null;

  public constructor(private readonly deps: IntegrationAgentDeps) {
    super(deps.jobId, deps.agentJobs, deps.jobSteps, deps.logger, deps.events, deps.minStepDurationMs);

    this.steps = [
      { name: 'fetch_docs', run: (context) => this.fetchDocs(context) },
      { name: 'discover_endpoints', run: () => this.discoverEndpoints() },
      { name: 'validate_credentials', run: (context) => this.validateCredentials(context) },
      { name: 'test_apis', run: () => this.testApis() },
      { name: 'register_tool', run: () => this.registerTool() },
      { name: 'generate_report', run: () => this.generateReport() },
    ];
  }

  private async fetchDocs(context: IntegrationContext): Promise<void> {
    this.discovered = await discoverToolSpec(context.request.toolName, this.deps.specFetchOptions);
    this.deps.logger.info(
      { jobId: this.deps.jobId, toolName: context.request.toolName, matched: this.discovered.matched, specUrl: this.discovered.specUrl },
      'Resolved tool documentation',
    );
  }

  private async discoverEndpoints(): Promise<void> {
    if (!this.discovered) {
      throw new Error('fetch_docs step did not produce a result');
    }
    if (!this.discovered.matched) {
      // A genuinely negative finding, not a failure — no public spec
      // exists for this name at any URL actually checked.
      this.deps.logger.info(
        { jobId: this.deps.jobId, attemptedUrls: this.discovered.attemptedUrls },
        'No public OpenAPI specification found for this tool',
      );
    }
  }

  private async validateCredentials(context: IntegrationContext): Promise<void> {
    const slug = context.request.toolName.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') || 'tool';
    await this.deps.cloudSecrets.putSecret(`integration/${slug}/api-key`, context.request.apiKey);
  }

  private async testApis(): Promise<void> {
    if (!this.discovered) {
      throw new Error('fetch_docs step did not produce a result');
    }
    const liveTest = this.discovered.liveTest;
    if (!liveTest) {
      this.liveTest = {
        attempted: false,
        description: this.discovered.matched
          ? 'No anonymous-safe endpoint available — every real operation on this API requires an authenticated key'
          : 'No public API surface was located to test',
        statusCode: null,
        latencyMs: null,
        error: null,
      };
      return;
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(liveTest.url, { method: liveTest.method });
      this.liveTest = {
        attempted: true,
        description: liveTest.description,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        error: null,
      };
    } catch (error) {
      this.liveTest = {
        attempted: true,
        description: liveTest.description,
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async registerTool(): Promise<void> {
    if (!this.discovered) {
      throw new Error('fetch_docs step did not produce a result');
    }
    if (!this.discovered.matched) {
      return;
    }
    const entry = await this.deps.toolRegistry.create({
      name: this.discovered.displayName,
      description: `Auto-discovered from ${this.discovered.specUrl}`,
      type: 'rest_api',
      base_url: new URL(this.discovered.specUrl).origin,
      auth_type: 'api_key',
      endpoints: this.discovered.endpoints as unknown as Array<Record<string, unknown>>,
      credential_ref: `integration/${this.discovered.toolName.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}/api-key`,
      health_status: this.liveTest.attempted && this.liveTest.statusCode && this.liveTest.statusCode < 400 ? 'healthy' : 'unknown',
      last_health_check: this.liveTest.attempted ? new Date() : null,
    });
    this.registryEntryId = entry.id;
  }

  private async generateReport(): Promise<void> {
    if (!this.discovered) {
      throw new Error('Prior steps did not complete successfully');
    }

    const report: IntegrationReport = {
      toolName: this.discovered.toolName,
      specFound: this.discovered.matched,
      specUrl: this.discovered.matched ? this.discovered.specUrl : null,
      attemptedUrls: this.discovered.attemptedUrls,
      totalEndpointCount: this.discovered.totalEndpointCount,
      endpoints: this.discovered.endpoints,
      credentialStored: true,
      liveTest: this.liveTest,
      registryEntryId: this.registryEntryId,
    };

    await this.deps.agentJobs.update(this.deps.jobId, { result_summary: report as unknown as Record<string, unknown> });
    this.publishCompletedResult(report);
  }
}
