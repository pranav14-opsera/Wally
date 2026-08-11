import type { IBaseAgent } from '../base/index.js';

export interface ILoadTestingAgent extends IBaseAgent {
  readonly agentType: 'load-testing';
}
