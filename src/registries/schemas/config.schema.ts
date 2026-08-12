import { z } from 'zod';

import type { ConfigDataType } from '../types/config.types.js';

const KEY_MAX_LENGTH = 255;
const DATA_TYPES = ['string', 'number', 'boolean', 'json'] as const;

/**
 * Cross-validates a stored (always-text) `value` against its declared
 * `data_type`. Shared between `createConfigSchema`'s superRefine (which
 * has `data_type` in scope) and `ConfigRegistryService.update()` (which
 * doesn't — data_type is immutable, so update() re-validates the new
 * value against the *existing* entry's data_type instead).
 */
export function valueMatchesDataType(value: string, dataType: ConfigDataType): boolean {
  switch (dataType) {
    case 'number':
      // Matches the WO's own stated check ("parseable with parseFloat
      // and not NaN") rather than a stricter full-string numeric
      // regex — intentionally as loose as the spec requires.
      return !Number.isNaN(Number.parseFloat(value));
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'json':
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    case 'string':
      // Any value, including an empty string, is a valid 'string' —
      // explicit edge case in the WO.
      return true;
    default:
      return false;
  }
}

export const createConfigSchema = z
  .object({
    key: z.string().min(1).max(KEY_MAX_LENGTH),
    value: z.string(),
    data_type: z.enum(DATA_TYPES),
    description: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (!valueMatchesDataType(data.value, data.data_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value "${data.value}" is not valid for data_type "${data.data_type}"`,
      });
    }
  });

// data_type is deliberately absent — it's immutable after creation, per
// the WO's constraint. value's data_type cross-check happens in the
// service (against the existing entry's data_type), not here.
export const updateConfigSchema = z.object({
  value: z.string().optional(),
  description: z.string().min(1).optional(),
});

export const configQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
  category: z.string().min(1).optional(),
});

export type CreateConfigSchema = z.infer<typeof createConfigSchema>;
export type UpdateConfigSchema = z.infer<typeof updateConfigSchema>;
export type ConfigQuerySchema = z.infer<typeof configQuerySchema>;
