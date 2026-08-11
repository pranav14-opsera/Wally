import { z } from 'zod';

import type { AppConfig } from './schema.js';
import { envSchema } from './schema.js';

function formatZodError(error: z.ZodError): string {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return `Configuration validation failed: ${issues}`;
}

/**
 * Validates `process.env` against `envSchema` and returns a fully typed
 * `AppConfig`. Throws a single `Error` listing every invalid/missing
 * variable (not just the first one) so developers get complete feedback
 * in one pass rather than fixing one variable at a time.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }

  return result.data;
}
