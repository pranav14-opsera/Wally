import { loadConfig } from './loader.js';
import type { AppConfig } from './schema.js';

export type { AppConfig } from './schema.js';
export { envSchema } from './schema.js';
export { loadConfig } from './loader.js';

/**
 * Extension point for future database-backed configuration (e.g. numeric
 * runtime limits stored in a config table). Env-backed config (this module)
 * implements the same shape today; a DB-backed provider lands in a later
 * epic without changing how consumers read configuration.
 */
export interface IConfigProvider {
  getConfigValue(key: string): Promise<string | number | boolean>;
  getAllConfig(): Promise<Record<string, string | number | boolean>>;
}

let cachedConfig: AppConfig | undefined;

/**
 * Returns the process-wide `AppConfig`, validating `process.env` on first
 * call and caching the result for subsequent calls. Use `loadConfig`
 * directly (not this function) in tests that need a fresh, uncached parse.
 */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}
