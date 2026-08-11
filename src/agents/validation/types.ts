import type { IBaseAgent } from '../base/index.js';

export interface IValidationAgent extends IBaseAgent {
  readonly agentType: 'validation';
}
