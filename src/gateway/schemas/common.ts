import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1).describe('1-indexed page number'),
  limit: z.coerce.number().int().positive().max(100).default(20).describe('Items per page (max 100)'),
});

export const uuidParamsSchema = z.object({
  id: z.string().uuid().describe('Resource UUID'),
});

export const sortQuerySchema = z.object({
  sortBy: z.string().optional().describe('Field name to sort results by'),
  sortOrder: z.enum(['asc', 'desc']).default('asc').describe('Sort direction'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type UuidParams = z.infer<typeof uuidParamsSchema>;
export type SortQuery = z.infer<typeof sortQuerySchema>;
