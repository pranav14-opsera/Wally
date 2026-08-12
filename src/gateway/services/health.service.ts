import type { DataAdapterContext } from '../../adapters/data/index.js';
import type { DependencyHealth, HealthStatus, OverallStatus } from './health.types.js';

interface DependencyCheck {
  name: string;
  run: () => Promise<void>;
}

async function withTimeout(run: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Health check timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function aggregateStatus(dependencies: DependencyHealth[]): OverallStatus {
  const unhealthyCount = dependencies.filter((dependency) => dependency.status === 'unhealthy').length;
  if (unhealthyCount === 0) {
    return 'healthy';
  }
  return unhealthyCount === dependencies.length ? 'unhealthy' : 'degraded';
}

/**
 * Readiness aggregation for `/api/v1/health` and `/api/v1/health/ready`
 * (WO-046). Only checks the database today via `DataAdapterContext`'s own
 * `healthCheck()` (never a direct Prisma/Mongoose driver call, per this
 * WO's constraint) — Redis and BullMQ checks from `technical_details`
 * are deferred: no Redis client exists anywhere in this codebase yet
 * (WO-030's BullMQ/Redis setup is tracked as done in Forge but was never
 * actually implemented), so there is nothing real to check against. This
 * check never throws — every failure mode resolves to an `unhealthy`
 * `DependencyHealth` entry instead.
 */
export class HealthService {
  private readonly startedAt = Date.now();

  public constructor(
    private readonly dataAdapter: DataAdapterContext,
    private readonly timeoutMs: number,
  ) {}

  private get checks(): DependencyCheck[] {
    return [
      {
        name: 'database',
        run: async () => {
          const healthy = await this.dataAdapter.healthCheck();
          if (!healthy) {
            throw new Error(`${this.dataAdapter.engine} health check returned unhealthy`);
          }
        },
      },
    ];
  }

  private async runCheck(check: DependencyCheck): Promise<DependencyHealth> {
    const start = performance.now();
    try {
      await withTimeout(check.run, this.timeoutMs);
      return { name: check.name, status: 'healthy', latencyMs: Math.round(performance.now() - start) };
    } catch (error) {
      return {
        name: check.name,
        status: 'unhealthy',
        latencyMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async checkAll(): Promise<HealthStatus> {
    const dependencies = await Promise.all(this.checks.map((check) => this.runCheck(check)));

    return {
      status: aggregateStatus(dependencies),
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      dependencies,
    };
  }
}
