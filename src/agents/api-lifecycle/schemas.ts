import { z } from 'zod';

import type { AppConfig } from '../../config/index.js';

export function createApiLifecycleRunRequestSchema(config: AppConfig) {
  return z.object({
    apiName: z
      .string()
      .min(1)
      .max(config.TOOL_NAME_MAX_LENGTH)
      .describe('Any tool/API name to check for breaking changes — e.g. "GitHub", "Stripe"'),
  });
}

export type ApiLifecycleRunRequest = z.infer<ReturnType<typeof createApiLifecycleRunRequestSchema>>;
