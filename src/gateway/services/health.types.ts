export type DependencyStatus = 'healthy' | 'unhealthy';
export type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface DependencyHealth {
  name: string;
  status: DependencyStatus;
  latencyMs: number;
  error?: string;
}

export interface HealthStatus {
  status: OverallStatus;
  timestamp: string;
  uptime: number;
  dependencies: DependencyHealth[];
}
