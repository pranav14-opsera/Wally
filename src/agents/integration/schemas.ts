import { z } from 'zod';

import type { AppConfig } from '../../config/index.js';

export function createIntegrationRunRequestSchema(config: AppConfig) {
  return z.object({
    toolName: z
      .string()
      .min(1)
      .max(config.TOOL_NAME_MAX_LENGTH)
      .describe('Any tool/API name to discover and onboard — e.g. "GitHub", "OpenAI", "Grok"'),
    apiKey: z
      .string()
      .min(1)
      .max(config.SPEC_API_KEY_MAX_LENGTH)
      .default('demo-api-key-000')
      .describe('Credential to validate and store for this tool'),
  });
}

export type IntegrationRunRequest = z.infer<ReturnType<typeof createIntegrationRunRequestSchema>>;
