import type { IBaseAgent } from '../base/index.js';

export interface IApiLifecycleAgent extends IBaseAgent {
  readonly agentType: 'api-lifecycle';
}
