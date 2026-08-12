import 'dotenv/config';

import bcrypt from 'bcryptjs';

import type { AgentType, DataAdapterContext, LoadTestResult, UserRole } from '../adapters/data/index.js';
import { buildDataAdapterConfig, createDataAdapter } from '../adapters/data/index.js';
import { getConfig } from '../config/index.js';
import { createLogger } from '../logging/index.js';

// Fixed so the demo video's login screen always works with a value the
// presenter can type from memory — not a secret worth rotating per run.
const DEMO_PASSWORD = 'WallyDemo2026!';

const DEMO_USERS: { email: string; name: string; role: UserRole; password?: string }[] = [
  { email: 'admin@wally.dev', name: 'Ada Admin', role: 'admin' },
  { email: 'manager@wally.dev', name: 'Max Manager', role: 'manager' },
  { email: 'viewer@wally.dev', name: 'Vic Viewer', role: 'viewer' },
  // Short login for a personal, local-only demo instance. Inert everywhere
  // else: the login schema's password minimum defaults to 12 characters
  // (src/config/schema.ts — AUTH_MIN_PASSWORD_LENGTH), so "Admin" is
  // rejected before it ever reaches bcrypt unless an operator explicitly
  // lowers that value in their own untracked .env.
  { email: 'Admin', name: 'Local Admin', role: 'admin', password: 'Admin' },
];

interface SeedStep {
  name: string;
  durationMs: number;
}

async function seedHistoricalJob(
  dataAdapter: DataAdapterContext,
  userId: string,
  agentType: AgentType,
  inputParams: Record<string, unknown>,
  resultSummary: Record<string, unknown> | null,
  steps: SeedStep[],
  loadTestResult?: Omit<LoadTestResult, 'id' | 'created_at' | 'updated_at' | 'job_id'>,
): Promise<void> {
  const job = await dataAdapter.repositories.agentJobs.create({
    user_id: userId,
    agent_type: agentType,
    status: 'completed',
    input_params: inputParams,
    result_summary: resultSummary,
    current_step: steps.length,
    total_steps: steps.length,
    error_message: null,
    queued_at: new Date(),
    started_at: new Date(),
    completed_at: new Date(),
  });

  for (const [index, step] of steps.entries()) {
    await dataAdapter.repositories.jobSteps.create({
      job_id: job.id,
      step_order: index,
      step_name: step.name,
      status: 'completed',
      input_data: null,
      output_data: null,
      error_message: null,
      duration_ms: step.durationMs,
      started_at: new Date(),
      completed_at: new Date(),
    });
  }

  if (loadTestResult) {
    await dataAdapter.repositories.loadTestResults.create({ job_id: job.id, ...loadTestResult });
  }
}

async function seedHistoricalData(dataAdapter: DataAdapterContext, managerId: string, logger: ReturnType<typeof createLogger>): Promise<void> {
  const existingIntegrationJobs = await dataAdapter.repositories.agentJobs.count({
    agent_type: { operator: 'eq', value: 'integration' },
  });
  if (existingIntegrationJobs > 0) {
    logger.info({ existingIntegrationJobs }, 'Historical agent job data already exists — skipping seed');
    return;
  }

  // Load Testing — one clean pass.
  await seedHistoricalJob(
    dataAdapter,
    managerId,
    'load_testing',
    { name: 'Checkout flow smoke test', targetUrl: 'http://localhost:3000/api/v1/health/live', vus: 10, durationSeconds: 15 },
    null,
    [
      { name: 'validate_profile', durationMs: 4 },
      { name: 'run_k6', durationMs: 15200 },
      { name: 'evaluate_slo', durationMs: 3 },
    ],
    {
      profile_config: { name: 'Checkout flow smoke test', targetUrl: 'http://localhost:3000/api/v1/health/live', vus: 10, durationSeconds: 15 },
      p50_latency_ms: 8.2,
      p95_latency_ms: 14.6,
      p99_latency_ms: 21.3,
      throughput_rps: 612.4,
      error_rate_pct: 0,
      slo_verdict: 'pass',
      raw_metrics: {},
      executed_at: new Date(),
    },
  );

  // Load Testing — one SLO fail, so the history isn't all-green.
  await seedHistoricalJob(
    dataAdapter,
    managerId,
    'load_testing',
    { name: 'Search API stress test', targetUrl: 'http://localhost:3000/api/v1/agents/load-testing/runs', vus: 50, durationSeconds: 20 },
    null,
    [
      { name: 'validate_profile', durationMs: 5 },
      { name: 'run_k6', durationMs: 20400 },
      { name: 'evaluate_slo', durationMs: 4 },
    ],
    {
      profile_config: { name: 'Search API stress test', targetUrl: 'http://localhost:3000/api/v1/agents/load-testing/runs', vus: 50, durationSeconds: 20 },
      p50_latency_ms: 210.5,
      p95_latency_ms: 890.2,
      p99_latency_ms: 1420.7,
      throughput_rps: 118.3,
      error_rate_pct: 4.2,
      slo_verdict: 'fail',
      raw_metrics: {},
      executed_at: new Date(),
    },
  );

  // Integration and API Lifecycle are genuinely dynamic (real spec
  // fetch/diff against whatever name is typed) — no canned historical
  // record would honestly represent that, so those two start with an
  // empty "no runs yet" list. The trigger form's quick-pick buttons
  // (GitHub, Stripe, Petstore, …) make it a one-click real run.
  logger.info({}, 'Seeded historical Load Testing data (Integration/API Lifecycle start empty — they run for real)');
}

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger('seed');
  const dataAdapter = await createDataAdapter(buildDataAdapterConfig(config.DATA_ENGINE));
  const defaultPasswordHash = await bcrypt.hash(DEMO_PASSWORD, config.BCRYPT_SALT_ROUNDS);

  try {
    let managerId: string | undefined;

    for (const demoUser of DEMO_USERS) {
      const existing = await dataAdapter.repositories.users.findMany(
        { email: { operator: 'eq', value: demoUser.email } },
        undefined,
        { kind: 'offset', limit: 1, offset: 0 },
      );

      if (existing.items.length > 0) {
        logger.info({ email: demoUser.email }, 'Demo user already exists — skipping');
        if (demoUser.role === 'manager') {
          managerId = existing.items[0]!.id;
        }
        continue;
      }

      const passwordHash = demoUser.password ? await bcrypt.hash(demoUser.password, config.BCRYPT_SALT_ROUNDS) : defaultPasswordHash;
      const created = await dataAdapter.repositories.users.create({
        email: demoUser.email,
        name: demoUser.name,
        password_hash: passwordHash,
        role: demoUser.role,
        is_locked: false,
        failed_login_attempts: 0,
        locked_until: null,
      });
      if (demoUser.role === 'manager') {
        managerId = created.id;
      }
      logger.info({ email: demoUser.email, role: demoUser.role }, 'Demo user created');
    }

    if (managerId) {
      await seedHistoricalData(dataAdapter, managerId, logger);
    }

    process.stdout.write(
      '\nDemo accounts ready:\n' +
        DEMO_USERS.map((user) => `  ${user.role.padEnd(8)} ${user.email.padEnd(20)} password: ${user.password ?? DEMO_PASSWORD}`).join('\n') +
        '\n\n',
    );
  } finally {
    await dataAdapter.disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
