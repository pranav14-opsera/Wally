import type { IBaseAgent } from '../base/index.js';

export interface IIntegrationAgent extends IBaseAgent {
  readonly agentType: 'integration';
}
