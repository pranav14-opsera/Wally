import { createStubMethod } from '../not-implemented.js';
import type { ComputeTaskConfig, ComputeTaskStatus, ICloudComputeService } from '../interfaces/index.js';

const PROVIDER = 'azure';
const BACKING_SERVICE = 'Azure Container Instances';

/**
 * TODO(WO-021 follow-up): implement against Azure Container Instances.
 * - SDK: @azure/arm-containerinstance
 * - Config: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, managed identity or AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID
 * - runTask maps to ContainerGroupsClient#beginCreateOrUpdate (container group name becomes the task ID)
 * - getTaskStatus maps to ContainerGroupsClient#get (instance view's currentState)
 * - stopTask maps to ContainerGroupsClient#beginStop
 */
export class AzureComputeStub implements ICloudComputeService {
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
