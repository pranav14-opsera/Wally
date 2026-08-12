import { z } from 'zod';

const API_NAME_MAX_LENGTH = 255;
const VERSION_MAX_LENGTH = 100;
// Loose "semver-like" pattern (technical_details' own wording) rather
// than strict semver — OpenAPI spec versions in the wild commonly use
// forms like "v1", "1.0", "2.1.3-beta", "2024-01-15".
const VERSION_PATTERN = /^v?\d+(\.\d+)*([.-][a-zA-Z0-9]+)*$/;

export const createSpecSchema = z.object({
  api_name: z.string().min(1).max(API_NAME_MAX_LENGTH),
  version: z.string().min(1).max(VERSION_MAX_LENGTH).regex(VERSION_PATTERN, 'version must look like a version string (e.g. "1.0", "v2.1.3-beta")'),
  // Any non-null plain object — this registry stores raw spec content
  // as-is, never resolving $ref pointers or validating OpenAPI
  // compliance (that's the agent's job, per the WO's constraint).
  spec_content: z.record(z.string(), z.unknown()),
});

export const specQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
  api_name: z.string().min(1).optional(),
});

export type CreateSpecSchema = z.infer<typeof createSpecSchema>;
export type SpecQuerySchema = z.infer<typeof specQuerySchema>;
