import { z } from 'zod';

const AUTH_TYPES = ['api_key', 'oauth2', 'basic', 'none'] as const;
const NAME_MAX_LENGTH = 255;

// Loose on purpose: endpoint shapes vary per tool (WO-023's own edge
// case list expects "very large endpoints jsonb payload (100+
// endpoints)" and arbitrary nested objects) — validate it's an array of
// objects, not a rigid per-field schema that would reject legitimate
// tool-specific endpoint metadata.
const endpointSchema = z.record(z.string(), z.unknown());

export const createToolSchema = z.object({
  name: z.string().min(1).max(NAME_MAX_LENGTH),
  description: z.string().min(1).optional(),
  type: z.string().min(1),
  base_url: z.string().url(),
  auth_type: z.enum(AUTH_TYPES),
  // Normalized to `[]` when omitted (never `null`) — the single
  // representation avoids the null-vs-empty-array duality the WO's edge
  // cases warn must be "handled consistently across Postgres jsonb and
  // MongoDB".
  endpoints: z.array(endpointSchema).default([]),
  credential_ref: z.string().min(1).optional(),
});

export const updateToolSchema = createToolSchema.partial();

export const toolQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
});

export type CreateToolSchema = z.infer<typeof createToolSchema>;
export type UpdateToolSchema = z.infer<typeof updateToolSchema>;
export type ToolQuerySchema = z.infer<typeof toolQuerySchema>;
