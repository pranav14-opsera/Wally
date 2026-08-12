import { createStubMethod } from '../not-implemented.js';
import type { ComputeTaskConfig, ComputeTaskStatus, ICloudComputeService } from '../interfaces/index.js';

const PROVIDER = 'gcp';
const BACKING_SERVICE = 'Google Cloud Run Jobs';

/**
 * TODO(WO-021 follow-up): implement against Google Cloud Run Jobs.
 * - SDK: @google-cloud/run
 * - Config: GOOGLE_APPLICATION_CREDENTIALS (or workload identity), GCP_PROJECT_ID, GCP_REGION
 * - runTask maps to JobsClient#runJob (returns an Operation whose name becomes the task ID)
 * - getTaskStatus maps to ExecutionsClient#getExecution
 * - stopTask maps to ExecutionsClient#cancelExecution
 */
export class GcpComputeStub implements ICloudComputeService {
  public runTask: (config: ComputeTaskConfig) => Promise<string> = createStubMethod(
    PROVIDER,
    'runTask',
    BACKING_SERVICE,
  );

  public getTaskStatus: (taskId: string) => Promise<ComputeTaskStatus> = createStubMethod(
    PROVIDER,
    'getTaskStatus',
    BACKING_SERVICE,
  );

  public stopTask: (taskId: string) => Promise<void> = createStubMethod(PROVIDER, 'stopTask', BACKING_SERVICE);
}
